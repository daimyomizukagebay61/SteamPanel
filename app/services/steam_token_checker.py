"""Validation service for token accounts (refresh token → cookies)."""

import base64
import json as _json

import aiohttp
from aiohttp import FormData
from loguru import logger

from app.services.steam_auth import _resolve_proxy
from app.core.proxy_manager import proxy_manager
from app.core.task_manager import task_manager
from pysteamauth.auth.schemas import FinalizeLoginStatus


def _decode_jwt_payload(token: str) -> dict:
    """Decode the payload section of a JWT without verifying the signature."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Token must have 3 parts (header.payload.signature)")
    payload_b64 = parts[1]
    # Pad base64 if needed
    payload_b64 += "=" * (-len(payload_b64) % 4)
    payload_bytes = base64.urlsafe_b64decode(payload_b64)
    return _json.loads(payload_bytes)


async def check_token_account(account: dict, params: dict, *, task_id: str) -> None:
    """Convert refresh_token → web cookies, fetch profile via cookies, update DB."""
    acc_id = account["id"]
    token = account["token"]

    # Step 1: Decode JWT to get steam_id
    await task_manager.set_step(task_id, 1, 4, "Декодирование токена", acc_id)
    try:
        jwt_payload = _decode_jwt_payload(token)
    except Exception as exc:
        logger.error(f"[token_checker] {account.get('login', acc_id)}: bad JWT — {exc}")
        await _mark_invalid(acc_id)
        raise

    steam_id = jwt_payload.get("sub")

    # Step 2: GET steamcommunity.com for sessionid cookie
    await task_manager.set_step(task_id, 2, 4, "Получение sessionid", acc_id)
    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else aiohttp.TCPConnector()
    jar = aiohttp.CookieJar(unsafe=True)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://steamcommunity.com",
    }
    timeout = aiohttp.ClientTimeout(total=30)

    try:
        async with aiohttp.ClientSession(
            connector=connector, cookie_jar=jar, headers=headers, timeout=timeout,
        ) as session:
            async with session.get("https://steamcommunity.com") as resp:
                await resp.read()

            sessionid = None
            for cookie in jar:
                if cookie.key == "sessionid":
                    sessionid = cookie.value
                    break
            if not sessionid:
                raise RuntimeError("Failed to acquire sessionid cookie")

            # Step 3: POST /jwt/finalizelogin with refresh_token as nonce
            await task_manager.set_step(task_id, 3, 4, "Получение куки", acc_id)
            form = FormData(fields=[
                ("nonce", token),
                ("sessionid", sessionid),
                ("redir", "https://steamcommunity.com/login/home/?goto="),
            ])
            async with session.post(
                "https://login.steampowered.com/jwt/finalizelogin",
                data=form,
            ) as resp:
                resp_text = await resp.text()
                if resp.status != 200:
                    raise RuntimeError(f"finalizelogin HTTP {resp.status}: {resp_text[:200]}")

            resp_json = _json.loads(resp_text)
            if not resp_json.get("steamID"):
                error_msg = resp_json.get("message", resp_text[:200])
                raise RuntimeError(f"finalizelogin failed: {error_msg}")

            finalize = FinalizeLoginStatus.model_validate(resp_json)
            steam_id = finalize.steamID or steam_id

            # Post to each transfer_info URL to set domain cookies
            for ti in finalize.transfer_info:
                form = FormData(fields=[
                    ("nonce", ti.params.nonce),
                    ("auth", ti.params.auth),
                    ("steamID", str(steam_id)),
                ])
                try:
                    async with session.post(ti.url, data=form) as _resp:
                        await _resp.read()
                except Exception:
                    pass

            # Visit extra domains to collect all cookies
            for url in ("https://store.steampowered.com", "https://help.steampowered.com"):
                try:
                    async with session.get(url) as _resp:
                        await _resp.read()
                except Exception:
                    pass

            # Collect cookies from jar
            all_cookies = []
            for c in jar:
                all_cookies.append({
                    "name": c.key,
                    "value": c.value,
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                    "secure": "secure" in str(c).lower(),
                    "httpOnly": "httponly" in str(c).lower(),
                })
            session_cookies_json = _json.dumps(all_cookies)
            logger.debug(f"[token_checker] {account.get('login', acc_id)}: got {len(all_cookies)} cookies")

            # Step 4: Fetch profile using authenticated session (cookies set)
            await task_manager.set_step(task_id, 4, 4, "Получение профиля", acc_id)
            nickname = None
            steam_level = None
            avatar_url = None
            last_online = None
            if steam_id and steam_id != "0":
                profile_url = f"https://steamcommunity.com/profiles/{steam_id}/"
                try:
                    async with session.get(profile_url) as resp:
                        if resp.status == 200:
                            html = await resp.text()
                            from app.services.steam_profile import (
                                _parse_persona_name, _parse_avatar, _parse_level, _parse_last_online,
                            )
                            nickname = _parse_persona_name(html)
                            avatar_url = _parse_avatar(html)
                            steam_level = _parse_level(html)
                            last_online = _parse_last_online(html)
                except Exception as exc:
                    logger.warning(f"[token_checker] profile fetch error: {exc}")

        # Update DB
        from app.database import get_db
        db = await get_db()
        await db.execute(
            """UPDATE token_accounts
               SET steam_id = ?, nickname = ?, steam_level = ?, avatar_url = ?, last_online = ?,
                   session_cookies = ?, status = 'valid', updated_at = datetime('now')
               WHERE id = ?""",
            (steam_id, nickname, steam_level, avatar_url, last_online, session_cookies_json, acc_id),
        )
        await db.commit()
        logger.success(f"[token_checker] {account.get('login', acc_id)} → valid, steam_id={steam_id}")

    except Exception as exc:
        await _mark_invalid(acc_id)
        logger.error(f"[token_checker] {account.get('login', acc_id)} → {exc}")
        raise


async def _mark_invalid(acc_id: int) -> None:
    from app.database import get_db
    db = await get_db()
    await db.execute(
        "UPDATE token_accounts SET status = 'invalid', updated_at = datetime('now') WHERE id = ?",
        (acc_id,),
    )
    await db.commit()
