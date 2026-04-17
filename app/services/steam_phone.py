import json
import re

from loguru import logger

from app.services.steam_auth import create_steam_session, close_steam
from app.services.steam_wizard import AJAX_HEADERS, run_common_wizard

_PHONE_RE = re.compile(r"^\+\d{7,15}$")


def _get_fresh_sessionid(steam) -> str:
    """Get sessionid from the live aiohttp cookie jar (not from stale storage)."""
    return steam._requests.cookies("help.steampowered.com").get("sessionid", "")


def _validate_phone(phone: str) -> str:
    """Strip spaces/dashes and verify E.164-like format."""
    cleaned = re.sub(r"[\s\-()]", "", phone)
    if cleaned and not cleaned.startswith("+"):
        cleaned = "+" + cleaned
    if not _PHONE_RE.match(cleaned):
        raise ValueError(
            f"Неверный формат номера: '{phone}'. "
            "Ожидается международный формат, например +79123456789"
        )
    return cleaned


async def change_phone(account: dict, params: dict, task_id: str = "") -> None:
    """Change phone number on a Steam account via recovery wizard + interactive prompts."""
    from app.core.task_manager import task_manager

    login = account["login"]
    new_phone = params.get("new_phone", "")
    if new_phone:
        new_phone = _validate_phone(new_phone)
    await task_manager.set_step(task_id, 1, 5, "Авторизация", acc_id=account["id"])
    logger.info(f"[change_phone] {login}: logging in to Steam...")
    steam = await create_steam_session(account)
    try:
        password = account["password"]
        await task_manager.set_step(task_id, 2, 5, "Wizard", acc_id=account["id"])
        logger.info(f"[change_phone] {login}: auth ok, starting phone change wizard...")

        wizard = await run_common_wizard(
            steam,
            entry_url="https://help.steampowered.com/en/wizard/HelpRemovePhoneNumber?redir=store/account",
            login=login,
            password=password,
        )
        logger.info(f"[change_phone] {login}: wizard done")

        if not new_phone:
            new_phone = await task_manager.prompt_user(task_id, f"Введите новый номер телефона для {login}", login=login)
        if not new_phone:
            raise ValueError("new_phone is required")
        new_phone = _validate_phone(new_phone)

        await task_manager.set_step(task_id, 3, 5, "Запрос смены", acc_id=account["id"])
        logger.info(f"[change_phone] {login}: requesting phone change -> {new_phone}...")

        fresh_sid = _get_fresh_sessionid(steam)
        text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryChangePhone/",
            method="POST",
            data={
                "s": wizard.s,
                "account": wizard.account,
                "sessionid": fresh_sid,
                "wizard_ajax": 1,
                "gamepad": 0,
                "phone_number": new_phone,
            },
            headers=AJAX_HEADERS,
        )
        data = json.loads(text) if isinstance(text, str) else text
        logger.info(f"[change_phone] {login}: change request response: {data}")
        if data.get("errorMsg"):
            err = data["errorMsg"]
            hint = ""
            if "112" in err:
                hint = " (номер уже привязан к другому аккаунту, виртуальный/VoIP, или не поддерживается Steam)"
            raise RuntimeError(f"Phone change request failed: {err}{hint}")

        await task_manager.set_step(task_id, 4, 5, "SMS код", acc_id=account["id"])
        sms_code = await task_manager.prompt_user(task_id, f"Введите SMS код с номера {new_phone}", login=login)
        if not sms_code:
            raise ValueError("sms_code is required")
        sms_code = sms_code.strip()

        logger.info(f"[change_phone] {login}: confirming with SMS code...")
        fresh_sid = _get_fresh_sessionid(steam)
        confirm_text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryConfirmChangePhone/",
            method="POST",
            data={
                "s": wizard.s,
                "account": wizard.account,
                "sessionid": fresh_sid,
                "wizard_ajax": 1,
                "gamepad": 0,
                "phone_number": new_phone,
                "phone_change_code": sms_code,
            },
            headers=AJAX_HEADERS,
        )
        confirm_data = json.loads(confirm_text) if isinstance(confirm_text, str) else confirm_text
        logger.info(f"[change_phone] {login}: confirm response: {confirm_data}")
        if confirm_data.get("errorMsg"):
            raise RuntimeError(f"Phone confirmation failed: {confirm_data['errorMsg']}")

        await task_manager.set_step(task_id, 5, 5, "Сохранение", acc_id=account["id"])
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE accounts SET phone = ?, updated_at = datetime('now') WHERE id = ?",
            (new_phone, account["id"]),
        )
        await db.commit()

        logger.success(f"[change_phone] {login}: phone changed -> {new_phone}")
    finally:
        await close_steam(steam)


async def remove_phone(account: dict, params: dict, task_id: str = "") -> None:
    """Remove phone by changing it to a disposable number + SMS confirmation."""
    from app.core.task_manager import task_manager

    login = account["login"]
    new_phone = params.get("new_phone", "")
    if new_phone:
        new_phone = _validate_phone(new_phone)
    await task_manager.set_step(task_id, 1, 5, "Авторизация", acc_id=account["id"])
    logger.info(f"[remove_phone] {login}: logging in to Steam...")
    steam = await create_steam_session(account)
    try:
        password = account["password"]
        await task_manager.set_step(task_id, 2, 5, "Wizard", acc_id=account["id"])
        logger.info(f"[remove_phone] {login}: starting phone removal wizard...")

        wizard = await run_common_wizard(
            steam,
            entry_url="https://help.steampowered.com/en/wizard/HelpRemovePhoneNumber?redir=store/account",
            login=login,
            password=password,
        )

        if not new_phone:
            new_phone = await task_manager.prompt_user(task_id, "Введите новый номер телефона (на который переставится старый)", login=login)
        if not new_phone:
            raise ValueError("new_phone is required for phone removal")
        new_phone = _validate_phone(new_phone)

        await task_manager.set_step(task_id, 3, 5, "Запрос смены", acc_id=account["id"])
        logger.info(f"[remove_phone] {login}: requesting phone change -> {new_phone}...")

        fresh_sid = _get_fresh_sessionid(steam)
        text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryChangePhone/",
            method="POST",
            data={
                "s": wizard.s,
                "account": wizard.account,
                "sessionid": fresh_sid,
                "wizard_ajax": 1,
                "gamepad": 0,
                "phone_number": new_phone,
            },
            headers=AJAX_HEADERS,
        )
        data = json.loads(text) if isinstance(text, str) else text
        logger.info(f"[remove_phone] {login}: change request response: {data}")
        if data.get("errorMsg"):
            raise RuntimeError(f"Phone change request failed: {data['errorMsg']}")

        await task_manager.set_step(task_id, 4, 5, "SMS код", acc_id=account["id"])
        sms_code = await task_manager.prompt_user(task_id, f"Введите SMS код с номера {new_phone}", login=login)
        if not sms_code:
            raise ValueError("sms_code is required")
        sms_code = sms_code.strip()

        logger.info(f"[remove_phone] {login}: confirming with SMS code...")
        fresh_sid = _get_fresh_sessionid(steam)
        confirm_text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryConfirmChangePhone/",
            method="POST",
            data={
                "s": wizard.s,
                "account": wizard.account,
                "sessionid": fresh_sid,
                "wizard_ajax": 1,
                "gamepad": 0,
                "phone_number": new_phone,
                "phone_change_code": sms_code,
            },
            headers=AJAX_HEADERS,
        )
        confirm_data = json.loads(confirm_text) if isinstance(confirm_text, str) else confirm_text
        logger.info(f"[remove_phone] {login}: confirm response: {confirm_data}")
        if confirm_data.get("errorMsg"):
            raise RuntimeError(f"Phone confirmation failed: {confirm_data['errorMsg']}")

        await task_manager.set_step(task_id, 5, 5, "Сохранение", acc_id=account["id"])
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE accounts SET phone = NULL, updated_at = datetime('now') WHERE id = ?",
            (account["id"],),
        )
        await db.commit()

        logger.success(f"[remove_phone] {login}: phone removed (changed to {new_phone})")
    finally:
        await close_steam(steam)
