import json
import secrets
import string
from pathlib import Path

from loguru import logger

from app.core.crypto import encrypt_password
from app.services.steam_auth import create_steam_session, close_steam, read_mafile_data
from app.services.steam_wizard import (
    AJAX_HEADERS,
    get_rsa_key,
    run_common_wizard,
)


async def change_password(account: dict, params: dict, task_id: str = "") -> None:
    """Change account password via Steam recovery wizard."""
    from app.core.task_manager import task_manager

    new_password = params.get("new_password", "")
    if not new_password:
        raise ValueError("new_password is required")

    login = account["login"]

    mafile_data = read_mafile_data(account)
    if not mafile_data:
        raise ValueError(f"No mafile found for {login} — cannot change password without 2FA")

    identity_secret = mafile_data.get("identity_secret", "")
    device_id = mafile_data.get("device_id")

    if not identity_secret:
        raise ValueError(f"No identity_secret in mafile for {login} — mobile confirmation impossible")
    if not device_id:
        raise ValueError(f"No device_id in mafile for {login} — mobile confirmation impossible")

    await task_manager.set_step(task_id, 1, 5, "Авторизация", acc_id=account["id"])
    logger.info(f"[change_password] {login}: logging in to Steam...")
    steam = await create_steam_session(account)
    logger.info(f"[change_password] {login}: auth ok")

    try:
        await task_manager.set_step(task_id, 2, 5, "Wizard", acc_id=account["id"])
        logger.info(f"[change_password] {login}: starting password change wizard...")
        wizard = await run_common_wizard(
            steam,
            entry_url="https://help.steampowered.com/wizard/HelpChangePassword?redir=store/account/",
            login=login,
            password=account["password"],
        )

        await task_manager.set_step(task_id, 3, 5, "RSA ключ", acc_id=account["id"])
        logger.info(f"[change_password] {login}: wizard done, getting RSA key...")
        mod, exp, timestamp = await get_rsa_key(steam, login)

        logger.info(f"[change_password] {login}: checking new password availability...")
        sessionid = await steam.sessionid("help.steampowered.com")
        check_text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxCheckPasswordAvailable/",
            method="POST",
            data={
                "sessionid": sessionid,
                "wizard_ajax": 1,
                "password": new_password,
            },
            headers=AJAX_HEADERS,
        )
        check_data = json.loads(check_text) if isinstance(check_text, str) else check_text
        if not check_data.get("available"):
            raise ValueError("New password is not available (too weak or reused)")

        encrypted_new = encrypt_password(new_password, mod, exp)
        await task_manager.set_step(task_id, 4, 5, "Отправка запроса", acc_id=account["id"])
        logger.info(f"[change_password] {login}: password available, sending change request...")
        result_text = await steam.request(
            url="https://help.steampowered.com/en/wizard/AjaxAccountRecoveryChangePassword/",
            method="POST",
            data={
                "sessionid": sessionid,
                "wizard_ajax": 1,
                "s": wizard.s,
                "account": wizard.account,
                "password": encrypted_new,
                "rsatimestamp": timestamp,
            },
            headers=AJAX_HEADERS,
        )

        result_data = json.loads(result_text) if isinstance(result_text, str) else result_text
        logger.debug(f"[change_password] {login}: change response: success={result_data.get('success')}, hasHash={bool(result_data.get('hash'))}")

        if result_data.get("errorMsg"):
            raise RuntimeError(f"Password change rejected by Steam: {result_data['errorMsg']}")
        if not result_data.get("hash"):
            raise RuntimeError(f"Password change failed — no confirmation hash from Steam: {result_data}")

        await task_manager.set_step(task_id, 5, 5, "Сохранение", acc_id=account["id"])
        from app.database import get_db
        db = await get_db()
        await db.execute(
            "UPDATE accounts SET password = ?, updated_at = datetime('now') WHERE id = ?",
            (new_password, account["id"]),
        )
        await db.commit()

        logger.success(f"[change_password] {login}: password changed")
    finally:
        await close_steam(steam)


def _generate_random_password(length: int = 24) -> str:
    alphabet = string.ascii_letters + string.digits + "!"
    return "".join(secrets.choice(alphabet) for _ in range(length))


async def random_password(account: dict, params: dict, task_id: str = "") -> None:
    """Change account password to a randomly generated one."""
    new_password = _generate_random_password()
    params["new_password"] = new_password
    await change_password(account, params)
