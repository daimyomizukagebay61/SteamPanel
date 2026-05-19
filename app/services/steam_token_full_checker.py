"""Full-check service for token accounts.

Performs the finalizelogin flow to obtain authenticated cookies, then calls
multiple Steam Web APIs in parallel to collect detailed account information,
and stores the result as JSON in the token_accounts.check_data column.
"""

from __future__ import annotations

import asyncio
import json as _json
import re
import urllib.parse
from datetime import datetime

import aiohttp
from aiohttp import FormData
from loguru import logger

from app.core.proxy_manager import proxy_manager
from app.core.task_manager import task_manager
from app.services.steam_auth import _resolve_proxy
from app.services.steam_profile import (
    _parse_avatar,
    _parse_last_online,
    _parse_level,
    _parse_persona_name,
)
from pysteamauth.auth.schemas import FinalizeLoginStatus

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_web_token(jar: aiohttp.CookieJar) -> str | None:
    """Extract the JWT access token from the steamLoginSecure cookie."""
    for cookie in jar:
        if cookie.key == "steamLoginSecure" and cookie.value:
            raw = urllib.parse.unquote(cookie.value)
            if "||" in raw:
                return raw.split("||", 1)[1]
    return None


def _build_cookie_jar_from_list(
    cookies: list[dict],
) -> aiohttp.CookieJar:
    """Reconstruct an aiohttp CookieJar from a list of cookie dicts."""
    jar = aiohttp.CookieJar(unsafe=True)
    import yarl

    for c in cookies:
        domain = c.get("domain", ".steamcommunity.com").lstrip(".")
        scheme = "https" if c.get("secure", True) else "http"
        jar.update_cookies(
            {c["name"]: c["value"]},
            response_url=yarl.URL(f"{scheme}://{domain}/"),
        )
    return jar


# ---------------------------------------------------------------------------
# Individual API fetchers (each returns a partial dict or raises)
# ---------------------------------------------------------------------------


async def _fetch_wallet(session: aiohttp.ClientSession, web_token: str) -> dict:
    """POST wallet details → balance_raw, user_country."""
    url = (
        "https://api.steampowered.com/IUserAccountService/GetClientWalletDetails/v1/"
        f"?access_token={web_token}"
    )
    try:
        async with session.post(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            data = await resp.json(content_type=None)
        inner = data.get("response", {})
        balance_raw = inner.get("formatted_balance") or None
        if not balance_raw:
            # Construct from balance (cents) and currency if formatted_balance missing
            cents = inner.get("balance", 0)
            currency = inner.get("wallet_currency", "")
            if cents:
                balance_raw = f"{cents / 100:.2f} {currency}".strip()
        return {
            "balance_raw": balance_raw,
            "user_country": inner.get("user_country") or None,
        }
    except Exception as exc:
        logger.debug(f"[full_check] wallet API error: {exc}")
        return {"balance_raw": None, "user_country": None}


async def _fetch_family_group(session: aiohttp.ClientSession, web_token: str) -> dict:
    """GET family group → family_group (bool)."""
    url = (
        "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/"
        f"?access_token={web_token}"
    )
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            data = await resp.json(content_type=None)
        inner = data.get("response", {})
        # If the account is in a family group there will be a family_groupid
        has_group = bool(inner.get("family_groupid") or inner.get("family_group"))
        return {"family_group": has_group}
    except Exception as exc:
        logger.debug(f"[full_check] family group API error: {exc}")
        return {"family_group": False}


async def _fetch_recently_played(
    session: aiohttp.ClientSession, web_token: str, steam_id: str
) -> dict:
    """GET recently played games → playtime_2weeks (total minutes)."""
    url = (
        "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/"
        f"?access_token={web_token}&steamid={steam_id}"
    )
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            data = await resp.json(content_type=None)
        games = data.get("response", {}).get("games", []) or []
        total_minutes = sum(g.get("playtime_2weeks", 0) for g in games)
        return {"playtime_2weeks": total_minutes}
    except Exception as exc:
        logger.debug(f"[full_check] recently played API error: {exc}")
        return {"playtime_2weeks": 0}


async def _fetch_inventory(
    session: aiohttp.ClientSession, steam_id: str, appid: int
) -> tuple[int, int]:
    """GET inventory → (total_count, marketable_count).

    Uses count=1 to quickly fetch total_inventory_count.
    Marketable count is set to 0 (requires full inventory scan).
    """
    url = f"https://steamcommunity.com/inventory/{steam_id}/{appid}/2?l=english&count=1"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status == 403:
                # Private inventory
                return (0, 0)
            if resp.status != 200:
                return (0, 0)
            data = await resp.json(content_type=None)
        total = data.get("total_inventory_count", 0) if data else 0
        return (total, 0)
    except Exception as exc:
        logger.debug(f"[full_check] inventory appid={appid} error: {exc}")
        return (0, 0)


async def _fetch_profile_xml(session: aiohttp.ClientSession, steam_id: str) -> dict:
    """GET profile XML → trade_ban, created_date."""
    url = f"https://steamcommunity.com/profiles/{steam_id}?xml=1"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            xml = await resp.text()

        # Trade ban
        trade_ban: str | None = None
        m = re.search(r"<tradeBanState>(.*?)</tradeBanState>", xml)
        if m:
            trade_ban = m.group(1).strip() or None

        # Member since (creation date)
        created_date: str | None = None
        m = re.search(r"<memberSince>(.*?)</memberSince>", xml)
        if m:
            created_date = m.group(1).strip() or None

        return {"trade_ban": trade_ban, "created_date": created_date}
    except Exception as exc:
        logger.debug(f"[full_check] profile XML error: {exc}")
        return {"trade_ban": None, "created_date": None}


async def _fetch_profile_html(session: aiohttp.ClientSession, steam_id: str) -> dict:
    """GET profile HTML → display_name, avatar_url, steam_level, last_online."""
    url = f"https://steamcommunity.com/profiles/{steam_id}/"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            if resp.status != 200:
                return {
                    "display_name": None,
                    "avatar_url": None,
                    "steam_level": None,
                    "last_online": None,
                }
            html = await resp.text()
        return {
            "display_name": _parse_persona_name(html),
            "avatar_url": _parse_avatar(html),
            "steam_level": _parse_level(html),
            "last_online": _parse_last_online(html),
        }
    except Exception as exc:
        logger.debug(f"[full_check] profile HTML error: {exc}")
        return {
            "display_name": None,
            "avatar_url": None,
            "steam_level": None,
            "last_online": None,
        }


async def _fetch_phone_digits(session: aiohttp.ClientSession) -> dict:
    """GET /account/ → phone last digits."""
    url = "https://store.steampowered.com/account/"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            html = await resp.text()
        # "Ends in XX" or "ending in XX"
        m = re.search(r"[Ee]nds?\s+in\s+(\d+)", html)
        if not m:
            m = re.search(r"ending\s+in\s+(\d+)", html)
        return {"phone_digits": m.group(1) if m else None}
    except Exception as exc:
        logger.debug(f"[full_check] phone digits error: {exc}")
        return {"phone_digits": None}


async def _fetch_vac_and_limit(session: aiohttp.ClientSession) -> dict:
    """GET /wizard/VacBans → vac_status, limit_status, vac_games."""
    url = "https://help.steampowered.com/en/wizard/VacBans"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            html = await resp.text()
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")
        limit_status = "Lim" if soup.find("div", class_="help_event_limiteduser") else "NoLim"
        vac_status = "CLEAN"
        vac_games: list[str] = []
        vac_body = soup.find("div", class_="vac_body")
        if vac_body:
            ban_header = vac_body.find("div", class_="vac_ban_header")
            if ban_header:
                header_text = ban_header.get_text(strip=True).lower()
                if "game developer" in header_text or "game ban" in header_text:
                    vac_status = "GAME BAN"
                    for box in vac_body.find_all("div", class_="refund_info_box"):
                        for span in box.find_all("span", class_="help_highlight_text"):
                            name = span.get_text(strip=True)
                            if name:
                                vac_games.append(name)
                else:
                    vac_status = "VAC"
        return {"vac_status": vac_status, "limit_status": limit_status, "vac_games": vac_games}
    except Exception as exc:
        logger.debug(f"[full_check] vac/limit check error: {exc}")
        return {"vac_status": "", "limit_status": "", "vac_games": []}


async def _fetch_alert_status(session: aiohttp.ClientSession) -> dict:
    """GET /supportmessages/ → alert_status string."""
    url = "https://store.steampowered.com/supportmessages/"
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            html = await resp.text()

        if re.search(
            r"account[_\-\s]?locked|your account has been locked", html, re.IGNORECASE
        ):
            return {"alert_status": "LOCKED"}
        if re.search(r"restricted|limited account", html, re.IGNORECASE):
            return {"alert_status": "RESTRICTED"}
        if re.search(
            r"support message|alert|warning|action required", html, re.IGNORECASE
        ):
            return {"alert_status": "ALERT"}
        return {"alert_status": "None"}
    except Exception as exc:
        logger.debug(f"[full_check] alert status error: {exc}")
        return {"alert_status": "None"}


async def _fetch_market_limited(session: aiohttp.ClientSession) -> dict:
    """GET /market/ → market_limited (bool)."""
    url = "https://steamcommunity.com/market/"
    try:
        async with session.get(
            url,
            timeout=aiohttp.ClientTimeout(total=15),
            allow_redirects=True,
        ) as resp:
            final_url = str(resp.url)
            html = await resp.text()

        # If redirected to login or the page body indicates we are not logged in
        if "login.steampowered.com" in final_url:
            return {"market_limited": True}
        # Steam's market page includes this container only when logged in with market access
        if "market_headertip_container_warning" in html:
            return {"market_limited": True}
        # If it threw us to a "you must log in" page
        if re.search(
            r"g_bInternalBrowser|please log in|you are not logged in",
            html,
            re.IGNORECASE,
        ):
            return {"market_limited": True}
        return {"market_limited": False}
    except Exception as exc:
        logger.debug(f"[full_check] market limited error: {exc}")
        return {"market_limited": False}


# ---------------------------------------------------------------------------
# Finalizelogin flow (mirrors steam_token_checker.py)
# ---------------------------------------------------------------------------


async def _do_finalizelogin(
    account: dict,
) -> tuple[str, list[dict], str | None]:
    """Run the finalizelogin flow.

    Returns:
        (steam_id, all_cookies_list, web_token)
    Raises on failure.
    """
    import base64

    token = account["token"]

    # Decode JWT to get steam_id as fallback
    parts = token.split(".")
    steam_id: str = ""
    if len(parts) == 3:
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        try:
            payload = _json.loads(base64.urlsafe_b64decode(payload_b64))
            steam_id = payload.get("sub", "")
        except Exception:
            pass

    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else aiohttp.TCPConnector()
    jar = aiohttp.CookieJar(unsafe=True)
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Origin": "https://steamcommunity.com",
    }
    timeout = aiohttp.ClientTimeout(total=30)

    async with aiohttp.ClientSession(
        connector=connector,
        cookie_jar=jar,
        headers=headers,
        timeout=timeout,
    ) as session:
        # Seed sessionid cookie
        async with session.get("https://steamcommunity.com") as resp:
            await resp.read()

        sessionid: str | None = None
        for cookie in jar:
            if cookie.key == "sessionid":
                sessionid = cookie.value
                break
        if not sessionid:
            raise RuntimeError(
                "Failed to acquire sessionid cookie from steamcommunity.com"
            )

        # POST finalizelogin
        form = FormData(
            fields=[
                ("nonce", token),
                ("sessionid", sessionid),
                ("redir", "https://steamcommunity.com/login/home/?goto="),
            ]
        )
        async with session.post(
            "https://login.steampowered.com/jwt/finalizelogin",
            data=form,
        ) as resp:
            resp_text = await resp.text()
            if resp.status != 200:
                raise RuntimeError(
                    f"finalizelogin HTTP {resp.status}: {resp_text[:300]}"
                )

        resp_json = _json.loads(resp_text)
        if not resp_json.get("steamID"):
            error_msg = resp_json.get("message", resp_text[:200])
            raise RuntimeError(f"finalizelogin rejected: {error_msg}")

        finalize = FinalizeLoginStatus.model_validate(resp_json)
        steam_id = finalize.steamID or steam_id

        # Set domain cookies via transfer_info URLs
        for ti in finalize.transfer_info:
            form = FormData(
                fields=[
                    ("nonce", ti.params.nonce),
                    ("auth", ti.params.auth),
                    ("steamID", str(steam_id)),
                ]
            )
            try:
                async with session.post(ti.url, data=form) as _resp:
                    await _resp.read()
            except Exception:
                pass

        # Visit extra domains to collect all cookies
        for url in (
            "https://store.steampowered.com",
            "https://help.steampowered.com",
        ):
            try:
                async with session.get(url) as _resp:
                    await _resp.read()
            except Exception:
                pass

        # Extract web_token from steamLoginSecure cookie
        web_token = _extract_web_token(jar)

        # Serialise cookies
        all_cookies: list[dict] = []
        for c in jar:
            all_cookies.append(
                {
                    "name": c.key,
                    "value": c.value,
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                    "secure": "secure" in str(c).lower(),
                    "httpOnly": "httponly" in str(c).lower(),
                }
            )

    return str(steam_id), all_cookies, web_token


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

TOTAL_STEPS = 6


async def full_check_token_account(
    account: dict, params: dict, *, task_id: str
) -> None:
    """Full-check a token account and persist results to the DB.

    Steps:
        1. Decode JWT / prepare
        2. finalizelogin flow
        3. Parallel API calls – Steam Web APIs
        4. Parallel API calls – Community pages
        5. Parallel API calls – Inventories
        6. Save to DB
    """
    acc_id = account["id"]
    login_label = account.get("login") or str(acc_id)

    await task_manager.set_step(task_id, 1, TOTAL_STEPS, "Подготовка токена", acc_id)

    # ------------------------------------------------------------------ #
    # Step 2: finalizelogin                                                #
    # ------------------------------------------------------------------ #
    await task_manager.set_step(
        task_id, 2, TOTAL_STEPS, "Авторизация (finalizelogin)", acc_id
    )
    try:
        steam_id, all_cookies, web_token = await _do_finalizelogin(account)
    except Exception as exc:
        logger.error(f"[full_check] {login_label}: finalizelogin failed — {exc}")
        await _mark_invalid(acc_id)
        raise

    session_cookies_json = _json.dumps(all_cookies)
    logger.debug(
        f"[full_check] {login_label}: finalizelogin OK, "
        f"steam_id={steam_id}, web_token={'yes' if web_token else 'NO'}, "
        f"cookies={len(all_cookies)}"
    )

    # ------------------------------------------------------------------ #
    # Rebuild an authenticated aiohttp session from the saved cookies     #
    # ------------------------------------------------------------------ #
    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else aiohttp.TCPConnector()
    auth_jar = _build_cookie_jar_from_list(all_cookies)
    auth_headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
    }

    async with aiohttp.ClientSession(
        connector=connector,
        cookie_jar=auth_jar,
        headers=auth_headers,
        timeout=aiohttp.ClientTimeout(total=30),
    ) as session:
        # -------------------------------------------------------------- #
        # Step 3: Steam Web API calls (need web_token)                    #
        # -------------------------------------------------------------- #
        await task_manager.set_step(
            task_id, 3, TOTAL_STEPS, "Steam Web API (кошелёк / игры / семья)", acc_id
        )

        if web_token:
            api_results = await asyncio.gather(
                _fetch_wallet(session, web_token),
                _fetch_family_group(session, web_token),
                _fetch_recently_played(session, web_token, steam_id),
                return_exceptions=True,
            )
        else:
            # No web_token — skip Steam Web API calls, use safe defaults
            logger.warning(
                f"[full_check] {login_label}: no web_token — skipping Steam Web API calls"
            )
            api_results = [
                {"balance_raw": None, "user_country": None},
                {"family_group": False},
                {"playtime_2weeks": 0},
            ]

        wallet_data = (
            api_results[0]
            if isinstance(api_results[0], dict)
            else {"balance_raw": None, "user_country": None}
        )
        family_data = (
            api_results[1]
            if isinstance(api_results[1], dict)
            else {"family_group": False}
        )
        played_data = (
            api_results[2]
            if isinstance(api_results[2], dict)
            else {"playtime_2weeks": 0}
        )

        # -------------------------------------------------------------- #
        # Step 4: Community/Store page calls                              #
        # -------------------------------------------------------------- #
        await task_manager.set_step(
            task_id, 4, TOTAL_STEPS, "Профиль / телефон / маркет / алерты", acc_id
        )

        page_results = await asyncio.gather(
            _fetch_profile_html(session, steam_id),
            _fetch_profile_xml(session, steam_id),
            _fetch_phone_digits(session),
            _fetch_alert_status(session),
            _fetch_market_limited(session),
            _fetch_vac_and_limit(session),
            return_exceptions=True,
        )

        profile_data = (
            page_results[0]
            if isinstance(page_results[0], dict)
            else {
                "display_name": None,
                "avatar_url": None,
                "steam_level": None,
                "last_online": None,
            }
        )
        xml_data = (
            page_results[1]
            if isinstance(page_results[1], dict)
            else {"trade_ban": None, "created_date": None}
        )
        phone_data = (
            page_results[2]
            if isinstance(page_results[2], dict)
            else {"phone_digits": None}
        )
        alert_data = (
            page_results[3]
            if isinstance(page_results[3], dict)
            else {"alert_status": "None"}
        )
        market_data = (
            page_results[4]
            if isinstance(page_results[4], dict)
            else {"market_limited": False}
        )
        vac_data = (
            page_results[5]
            if isinstance(page_results[5], dict)
            else {"vac_status": "", "limit_status": ""}
        )

        # -------------------------------------------------------------- #
        # Step 5: Inventory checks                                        #
        # -------------------------------------------------------------- #
        await task_manager.set_step(
            task_id, 5, TOTAL_STEPS, "Инвентари (CS2 / Dota2 / TF2 / Rust)", acc_id
        )

        inv_results = await asyncio.gather(
            _fetch_inventory(session, steam_id, 730),  # CS2
            _fetch_inventory(session, steam_id, 570),  # Dota 2
            _fetch_inventory(session, steam_id, 440),  # TF2
            _fetch_inventory(session, steam_id, 252490),  # Rust
            return_exceptions=True,
        )

        def _inv(result: object) -> tuple[int, int]:
            if isinstance(result, tuple):
                return result
            return (0, 0)

        cs2_total, cs2_mkt = _inv(inv_results[0])
        d2_total, d2_mkt = _inv(inv_results[1])
        tf2_total, tf2_mkt = _inv(inv_results[2])
        rust_total, rust_mkt = _inv(inv_results[3])

    # ------------------------------------------------------------------ #
    # Step 6: Assemble check_data & persist                               #
    # ------------------------------------------------------------------ #
    await task_manager.set_step(
        task_id, 6, TOTAL_STEPS, "Сохранение результатов", acc_id
    )

    check_data: dict = {
        "steam_id": steam_id,
        # Profile
        "display_name": profile_data.get("display_name"),
        "avatar_url": profile_data.get("avatar_url"),
        "steam_level": profile_data.get("steam_level"),
        "last_online": profile_data.get("last_online"),
        # Wallet
        "balance_raw": wallet_data.get("balance_raw"),
        "user_country": wallet_data.get("user_country"),
        # Family
        "family_group": family_data.get("family_group", False),
        # Playtime
        "playtime_2weeks": played_data.get("playtime_2weeks", 0),
        # Inventories (total / marketable)
        "inventory_cs2": cs2_total,
        "inventory_dota2": d2_total,
        "inventory_tf2": tf2_total,
        "inventory_rust": rust_total,
        "inventory_cs2_marketable": cs2_mkt,
        "inventory_dota2_marketable": d2_mkt,
        "inventory_tf2_marketable": tf2_mkt,
        "inventory_rust_marketable": rust_mkt,
        # Profile XML
        "trade_ban": xml_data.get("trade_ban"),
        "created_date": xml_data.get("created_date"),
        # Store/community pages
        "phone_digits": phone_data.get("phone_digits"),
        "alert_status": alert_data.get("alert_status", "None"),
        "market_limited": market_data.get("market_limited", False),
        # VAC / limit status
        "vac_status": vac_data.get("vac_status", ""),
        "limit_status": vac_data.get("limit_status", ""),
        "vac_games": vac_data.get("vac_games", []),
        # Timestamp
        "checked_at": datetime.utcnow().isoformat(),
    }

    from app.database import get_db

    db = await get_db()
    await db.execute(
        """UPDATE token_accounts
           SET steam_id      = ?,
               nickname      = ?,
               avatar_url    = ?,
               steam_level   = ?,
               last_online   = ?,
               session_cookies = ?,
               check_data    = ?,
               ban_status    = ?,
               vac_status    = ?,
               limit_status  = ?,
               vac_games     = ?,
               balance       = ?,
               country       = ?,
               status        = 'valid',
               updated_at    = datetime('now')
           WHERE id = ?""",
        (
            steam_id,
            check_data.get("display_name"),
            check_data.get("avatar_url"),
            check_data.get("steam_level"),
            check_data.get("last_online"),
            session_cookies_json,
            _json.dumps(check_data),
            check_data.get("alert_status"),
            check_data.get("vac_status"),
            check_data.get("limit_status"),
            _json.dumps(check_data.get("vac_games", [])) if check_data.get("vac_games") else None,
            check_data.get("balance_raw") or None,
            check_data.get("user_country") or None,
            acc_id,
        ),
    )
    await db.commit()

    logger.success(
        f"[full_check] {login_label} → valid | "
        f"balance={check_data['balance_raw']} | "
        f"country={check_data['user_country']} | "
        f"cs2={cs2_total} | dota2={d2_total} | "
        f"market_limited={check_data['market_limited']}"
    )


async def _mark_invalid(acc_id: int) -> None:
    from app.database import get_db

    db = await get_db()
    await db.execute(
        "UPDATE token_accounts SET status = 'invalid', updated_at = datetime('now') WHERE id = ?",
        (acc_id,),
    )
    await db.commit()
