import asyncio
import json

from loguru import logger

from app.services.steam_auth import create_steam_session, close_steam, extract_session_cookies
from app.services.steam_wizard import AJAX_HEADERS, run_common_wizard


def _get_fresh_sessionid(steam) -> str:
    """Get sessionid from the live aiohttp cookie jar."""
    return steam._requests.cookies("help.steampowered.com").get("sessionid", "")


async def change_email(account: dict, params: dict, task_id: str = "") -> None:
    """Change account email via Steam recovery wizard + interactive prompts."""
    from app.core.task_manager import task_manager

    login = account["login"]
    new_email = params.get("new_email", "")
    await task_manager.set_step(task_id, 1, 5, "Авторизация", acc_id=account["id"])
    logger.info(f"[change_email] {login}: logging in to Steam...")
    steam = await create_steam_session(account)
    try:
        password = account["password"]
        await task_manager.set_step(task_id, 2, 5, "Wizard", acc_id=account["id"])
        logger.info(f"[change_email] {login}: auth ok, starting email change wizard...")

        wizard = await run_common_wizard(
            steam,
            entry_url="https://help.steampowered.com/wizard/HelpChangeEmail?redir=store/account/",
            login=login,
            password=password,
        )
        logger.info(f"[change_email] {login}: wizard done")

        if not new_email:
            new_email = await task_manager.prompt_user(task_id, f"Введите новый email для {login}", login=login)
        if not new_email:
            raise ValueError("new_email is required")

        await task_manager.set_step(task_id, 3, 5, "Запрос смены", acc_id=account["id"])
        logger.info(f"[change_email] {login}: requesting email change -> {new_email}...")

        for attempt in range(2):
            fresh_sid = _get_fresh_sessionid(steam)
            text = await steam.request(
                url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryChangeEmail/",
                method="POST",
                data={
                    "s": wizard.s,
                    "account": wizard.account,
                    "sessionid": fresh_sid,
                    "wizard_ajax": 1,
                    "gamepad": 0,
                    "email": new_email,
                },
                headers=AJAX_HEADERS,
            )
            data = json.loads(text) if isinstance(text, str) else text
            logger.debug(f"[change_email] {login}: change request attempt {attempt+1} response: {data}")
            if data.get("errorMsg"):
                error_code = data.get("success", 0)
                if error_code == 24:
                    raise PermissionError(f"Insufficient privileges for email change: {data['errorMsg']}")
                raise RuntimeError(f"Email change request failed: {data['errorMsg']}")

            if attempt == 0:
                await asyncio.sleep(3)

        await task_manager.set_step(task_id, 4, 5, "Код подтверждения", acc_id=account["id"])
        email_code = await task_manager.prompt_user(task_id, f"Введите код подтверждения с email ({new_email})", login=login)
        if not email_code:
            raise ValueError("email_code is required")
        email_code = email_code.strip()

        logger.info(f"[change_email] {login}: confirming email change...")
        fresh_sid = _get_fresh_sessionid(steam)
        confirm_text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryConfirmChangeEmail/",
            method="POST",
            data={
                "s": wizard.s,
                "account": wizard.account,
                "sessionid": fresh_sid,
                "wizard_ajax": 1,
                "gamepad": 0,
                "email": new_email,
                "email_change_code": email_code,
            },
            headers=AJAX_HEADERS,
        )
        confirm_data = json.loads(confirm_text) if isinstance(confirm_text, str) else confirm_text
        logger.debug(f"[change_email] {login}: confirm response: success={confirm_data.get('success')}")

        error_code = confirm_data.get("success", 0)
        if confirm_data.get("errorMsg") and error_code != 29:
            raise RuntimeError(f"Email confirmation failed: {confirm_data['errorMsg']}")

        await task_manager.set_step(task_id, 5, 5, "Сохранение", acc_id=account["id"])
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE accounts SET email = ?, updated_at = datetime('now') WHERE id = ?",
            (new_email, account["id"]),
        )
        await db.commit()

        logger.success(f"[change_email] {login}: email changed successfully -> {new_email}")
    finally:
        await close_steam(steam)


async def validate_account(account: dict, params: dict, task_id: str = "") -> None:
    """Validate account credentials by attempting login. Fetches profile and ban status on success."""
    from app.database import get_db
    from app.services.steam_auth import close_steam
    from app.services.steam_profile import fetch_profile
    from app.services.steam_ban import check_ban
    from app.core.task_manager import task_manager
    from app.config import read_validation_settings

    steam = None
    error_msg = None
    ban_status = ""

    val_settings = read_validation_settings()

    login = account["login"]
    profile = None
    try:
        await task_manager.set_step(task_id, 1, 4, "Авторизация", acc_id=account["id"])
        logger.info(f"[validate] {login}: logging in to Steam...")
        steam = await create_steam_session(account)
        status = "valid"
        logger.info(f"[validate] {login}: auth ok")

        if status == "valid" and steam is not None:
            if val_settings.get("check_ban"):
                await task_manager.set_step(task_id, 2, 4, "Проверка бана", acc_id=account["id"])
                logger.info(f"[validate] {login}: checking ban status...")
                ban_status = await check_ban(steam)
                logger.info(f"[validate] {login}: ban = {ban_status or 'none'}")
            if account.get("steam_id") and val_settings.get("fetch_profile"):
                await task_manager.set_step(task_id, 3, 4, "Профиль", acc_id=account["id"])
                logger.info(f"[validate] {login}: fetching profile (id={account['steam_id']})...")
                profile = await fetch_profile(account["steam_id"], steam=steam)
                if profile:
                    logger.info(f"[validate] {login}: profile fetched — {profile.get('nickname')}, lvl={profile.get('steam_level')}")
                else:
                    logger.warning(f"[validate] {login}: failed to fetch profile")

        await task_manager.set_step(task_id, 4, 4, "Сохранение", acc_id=account["id"])
        if steam is not None and status == "valid":
            try:
                session_cookies = extract_session_cookies(steam)
                if session_cookies:
                    _db = await get_db()
                    await _db.execute(
                        "UPDATE accounts SET session_cookies = ?, updated_at = datetime('now') WHERE id = ?",
                        (session_cookies, account["id"]),
                    )
                    await _db.commit()
                    logger.debug(f"[validate] {login}: saved session cookies")
            except Exception as cookie_err:
                logger.warning(f"[validate] {login}: failed to save cookies — {cookie_err}")

            from app.services.steam_auth import update_mafile_tokens
            if update_mafile_tokens(steam, account):
                logger.info(f"[validate] {login}: updated mafile tokens")

    except Exception as exc:
        status = "invalid"
        error_msg = str(exc)
        logger.warning(f"[validate] {login}: error — {error_msg}")
    finally:
        if steam is not None:
            await close_steam(steam)

    db = await get_db()
    await db.execute(
        "UPDATE accounts SET status = ?, ban_status = ?, updated_at = datetime('now') WHERE id = ?",
        (status, ban_status or None, account["id"]),
    )
    await db.commit()

    if profile:
        sets = []
        vals = []
        for col, key in [("nickname", "nickname"), ("avatar_url", "avatar_url"), ("steam_level", "steam_level"), ("last_online", "last_online")]:
            if profile.get(key) is not None:
                sets.append(f"{col} = ?")
                vals.append(profile[key])
        if sets:
            sets.append("updated_at = datetime('now')")
            vals.append(account["id"])
            await db.execute(f"UPDATE accounts SET {', '.join(sets)} WHERE id = ?", vals)
            await db.commit()
        logger.info(f"[validate] {login}: profile saved — {profile.get('nickname')}")

    if error_msg:
        raise Exception(f"{error_msg}")
    else:
        ban_info = f" | ban={ban_status}" if ban_status else ""
        logger.info(f"[validate] {login}: result — {status}{ban_info}")
