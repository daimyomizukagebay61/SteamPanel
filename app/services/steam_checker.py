"""Validation service for log:pass accounts (no mafile)."""

from pathlib import Path

from bs4 import BeautifulSoup
from loguru import logger

from app.services.steam_auth import _resolve_proxy, ProxyRequestStrategy, close_steam, extract_session_cookies
from app.services.steam_ban import check_ban
from app.services.steam_profile import fetch_profile
from app.core.proxy_manager import proxy_manager
from app.core.task_manager import task_manager


async def check_logpass_account(account: dict, params: dict, *, task_id: str) -> None:
    """Login with login:pass only, get steamid/nickname, check ban, update DB row."""
    try:
        from pysteamauth.auth import Steam
    except ImportError:
        raise RuntimeError("pysteamauth not installed")

    acc_id = account["id"]
    proxy = await _resolve_proxy(account)
    request_strategy = None
    if proxy:
        connector = proxy_manager.get_connector(proxy)
        request_strategy = ProxyRequestStrategy(connector)
        logger.debug(f"[checker] Using proxy for {account['login']}")

    steam = Steam(
        login=account["login"],
        password=account["password"],
        request_strategy=request_strategy,
    )

    try:
        await task_manager.set_step(task_id, 1, 3, "Авторизация", acc_id)

        # Pre-validate password before attempting RSA encryption (Steam RSA-2048 max 245 bytes)
        password = account.get("password") or ""
        if len(password.encode("utf-8")) > 245:
            raise ValueError(
                f"Password is too long ({len(password)} chars) — possible mafile data imported as password. "
                "Re-import the account in login:password format."
            )

        await steam.login_to_steam()

        # Save session cookies right after login
        try:
            session_cookies_json = extract_session_cookies(steam)
            if session_cookies_json:
                from app.database import get_db as _get_db
                _db = await _get_db()
                await _db.execute(
                    "UPDATE logpass_accounts SET session_cookies = ? WHERE id = ?",
                    (session_cookies_json, acc_id),
                )
                await _db.commit()
                logger.debug(f"[checker] {account['login']}: saved session cookies")
        except Exception as cookie_err:
            logger.warning(f"[checker] {account['login']}: failed to save cookies — {cookie_err}")

        from app.config import read_validation_settings
        val_settings = read_validation_settings()

        steam_id = str(steam.steamid)
        ban_status = ""
        if val_settings.get("check_ban"):
            await task_manager.set_step(task_id, 2, 3, "Проверка бана", acc_id)
            ban_status = await check_ban(steam)

        nickname = None
        steam_level = None
        avatar_url = None
        last_online = None
        if steam_id and steam_id != "0" and val_settings.get("fetch_profile"):
            await task_manager.set_step(task_id, 3, 3, "Получение профиля", acc_id)
            profile = await fetch_profile(steam_id, steam=steam)
            if profile:
                nickname = profile.get("nickname")
                steam_level = profile.get("steam_level")
                avatar_url = profile.get("avatar_url")
                last_online = profile.get("last_online")

        from app.database import get_db
        db = await get_db()
        await db.execute(
            """UPDATE logpass_accounts
               SET steam_id = ?, nickname = ?, steam_level = ?, avatar_url = ?, last_online = ?,
                   ban_status = ?, status = 'valid', updated_at = datetime('now')
               WHERE id = ?""",
            (steam_id, nickname, steam_level, avatar_url, last_online, ban_status, acc_id),
        )
        await db.commit()
        logger.success(f"[checker] {account['login']} → valid, ban={ban_status}")

    except Exception as exc:
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE logpass_accounts SET status = 'invalid', updated_at = datetime('now') WHERE id = ?",
            (acc_id,),
        )
        await db.commit()
        logger.error(f"[checker] {account['login']} → {exc}")
        raise

    finally:
        await close_steam(steam)


async def _check_cs2_prime(steam, steam_id: str) -> str:
    """Check CS2 Prime status."""
    try:
        url = f"https://steamcommunity.com/profiles/{steam_id}/gcpd/730/?tab=primeaccount"
        resp = await steam.request(url, method="GET")
        html = resp if isinstance(resp, str) else resp.decode("utf-8", errors="ignore")
        if "no_personal_data_stored_message" in html:
            return "Disabled"
        if "personaldata_elements_container" in html and "Enabled" in html:
            return "Enabled"
        return "Disabled"
    except Exception as e:
        logger.debug(f"[full_parse] prime check error: {e}")
        return "Disabled"


async def _check_dota_trophy(steam, steam_id: str) -> str | None:
    """Check Dota 2 Trophy Score."""
    try:
        url = f"https://steamcommunity.com/profiles/{steam_id}/gcpd/570/?category=Stats&tab=Trophy"
        resp = await steam.request(url, method="GET")
        html = resp if isinstance(resp, str) else resp.decode("utf-8", errors="ignore")
        if "no_personal_data_stored_message" in html:
            return None
        if "personaldata_elements_container" in html:
            soup = BeautifulSoup(html, "html.parser")
            for row in soup.find_all("tr"):
                cells = row.find_all("td")
                if len(cells) >= 3:
                    try:
                        int(cells[0].get_text(strip=True))
                        score = cells[1].get_text(strip=True)
                        if score.isdigit():
                            return score
                    except (ValueError, AttributeError):
                        continue
        return None
    except Exception as e:
        logger.debug(f"[full_parse] trophy check error: {e}")
        return None


async def _check_dota_behavior(steam, steam_id: str) -> str | None:
    """Check Dota 2 Behavior Score."""
    try:
        url = f"https://steamcommunity.com/profiles/{steam_id}/gcpd/570/?category=Account&tab=MatchPlayerReportIncoming"
        resp = await steam.request(url, method="GET")
        html = resp if isinstance(resp, str) else resp.decode("utf-8", errors="ignore")
        if "no_personal_data_stored_message" in html:
            return None
        if "personaldata_elements_container" in html:
            soup = BeautifulSoup(html, "html.parser")
            for row in soup.find_all("tr"):
                cells = row.find_all("td")
                if cells:
                    last_cell = cells[-1].get_text(strip=True)
                    if last_cell.isdigit():
                        return last_cell
        return None
    except Exception as e:
        logger.debug(f"[full_parse] behavior check error: {e}")
        return None


async def _check_licenses(steam) -> str:
    """Get list of licenses (games) from Steam account."""
    try:
        resp = await steam.request("https://store.steampowered.com/account/licenses/", method="GET")
        html = resp if isinstance(resp, str) else resp.decode("utf-8", errors="ignore")
        soup = BeautifulSoup(html, "html.parser")
        table = soup.find("table", class_="account_table")
        if not table:
            return ""
        licenses = []
        rows = table.find_all("tr")
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) >= 2:
                game_cell = cells[1]
                remove_div = game_cell.find("div", class_="free_license_remove_link")
                if remove_div:
                    remove_div.decompose()
                name = game_cell.get_text(strip=True)
                if name:
                    licenses.append(name)
        return ", ".join(licenses)
    except Exception as e:
        logger.debug(f"[full_parse] licenses check error: {e}")
        return ""


async def full_parse_logpass_account(account: dict, params: dict, *, task_id: str) -> None:
    """Full parse: login, ban, profile, prime, trophy, behavior, licenses."""
    try:
        from pysteamauth.auth import Steam
    except ImportError:
        raise RuntimeError("pysteamauth not installed")

    acc_id = account["id"]
    proxy = await _resolve_proxy(account)
    request_strategy = None
    if proxy:
        connector = proxy_manager.get_connector(proxy)
        request_strategy = ProxyRequestStrategy(connector)

    steam = Steam(
        login=account["login"],
        password=account["password"],
        request_strategy=request_strategy,
    )

    try:
        await task_manager.set_step(task_id, 1, 6, "Авторизация", acc_id)
        await steam.login_to_steam()

        # Save session cookies
        try:
            session_cookies_json = extract_session_cookies(steam)
            if session_cookies_json:
                from app.database import get_db as _get_db
                _db = await _get_db()
                await _db.execute(
                    "UPDATE logpass_accounts SET session_cookies = ? WHERE id = ?",
                    (session_cookies_json, acc_id),
                )
                await _db.commit()
        except Exception as cookie_err:
            logger.warning(f"[full_parse] {account['login']}: failed to save cookies — {cookie_err}")

        steam_id = str(steam.steamid)

        await task_manager.set_step(task_id, 2, 6, "Проверка бана", acc_id)
        ban_status = await check_ban(steam)

        nickname = avatar_url = last_online = None
        steam_level = None
        if steam_id and steam_id != "0":
            await task_manager.set_step(task_id, 3, 6, "Профиль", acc_id)
            profile = await fetch_profile(steam_id, steam=steam)
            if profile:
                nickname = profile.get("nickname")
                steam_level = profile.get("steam_level")
                avatar_url = profile.get("avatar_url")
                last_online = profile.get("last_online")

        prime = "Disabled"
        trophy = None
        behavior = None
        if steam_id and steam_id != "0":
            await task_manager.set_step(task_id, 4, 6, "Prime / Trophy", acc_id)
            prime = await _check_cs2_prime(steam, steam_id)
            trophy = await _check_dota_trophy(steam, steam_id)
            behavior = await _check_dota_behavior(steam, steam_id)

        await task_manager.set_step(task_id, 5, 6, "Лицензии", acc_id)
        license_str = await _check_licenses(steam)

        await task_manager.set_step(task_id, 6, 6, "Сохранение", acc_id)
        from app.database import get_db
        db = await get_db()
        await db.execute(
            """UPDATE logpass_accounts
               SET steam_id = ?, nickname = ?, steam_level = ?, avatar_url = ?, last_online = ?,
                   ban_status = ?, prime = ?, trophy = ?, behavior = ?, license = ?,
                   status = 'valid', updated_at = datetime('now')
               WHERE id = ?""",
            (steam_id, nickname, steam_level, avatar_url, last_online,
             ban_status, prime, trophy, behavior, license_str, acc_id),
        )
        await db.commit()
        logger.success(f"[full_parse] {account['login']} → valid, ban={ban_status}, prime={prime}, trophy={trophy}, behavior={behavior}, licenses={len(license_str.split(', ')) if license_str else 0}")

    except Exception as exc:
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE logpass_accounts SET status = 'invalid', updated_at = datetime('now') WHERE id = ?",
            (acc_id,),
        )
        await db.commit()
        logger.error(f"[full_parse] {account['login']} → {exc}")
        raise

    finally:
        await close_steam(steam)
