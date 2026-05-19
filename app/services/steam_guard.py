import base64
import hashlib
import hmac
import struct
import time

from loguru import logger


def generate_2fa_code(shared_secret: str) -> str:
    """Generate a Steam Guard 2FA code from shared_secret."""
    timestamp = int(time.time()) // 30
    msg = struct.pack(">Q", timestamp)
    # Normalise: accept both standard (+/) and URL-safe (-_) base64, fix padding
    normalised = shared_secret.strip().replace("-", "+").replace("_", "/")
    normalised += "=" * (-len(normalised) % 4)
    key = base64.b64decode(normalised)
    auth = hmac.new(key, msg, hashlib.sha1).digest()

    offset = auth[19] & 0xF
    code = struct.unpack(">I", auth[offset : offset + 4])[0] & 0x7FFFFFFF

    chars = "23456789BCDFGHJKMNPQRTVWXY"
    result = []
    for _ in range(5):
        result.append(chars[code % len(chars)])
        code //= len(chars)

    return "".join(result)


async def remove_guard(account: dict, params: dict, task_id: str = "") -> None:
    """Remove Steam Guard 2FA via revocation code from mafile."""
    from app.services.steam_auth import create_steam_session, close_steam, read_mafile_data
    from app.core.task_manager import task_manager

    mafile = read_mafile_data(account)
    revocation_code = (mafile or {}).get("revocation_code", "") if mafile else ""
    if not revocation_code:
        raise ValueError("revocation_code not found in mafile")

    login = account["login"]
    await task_manager.set_step(task_id, 1, 3, "Авторизация", acc_id=account["id"])
    logger.info(f"[remove_guard] {login}: logging in to Steam...")
    steam = await create_steam_session(account)
    logger.info(f"[remove_guard] {login}: auth ok")
    try:
        await task_manager.set_step(task_id, 2, 3, "Удаление Guard", acc_id=account["id"])
        logger.info(f"[remove_guard] {login}: sending Guard removal request...")
        sessionid = await steam.sessionid("store.steampowered.com")

        await steam.request(
            url="https://store.steampowered.com/twofactor/remove",
            method="GET",
            params={"step": "promptdevice"},
        )
        await steam.request(
            url="https://store.steampowered.com/twofactor/remove",
            method="GET",
            params={"step": "promptrcode"},
        )
        await steam.request(
            url="https://store.steampowered.com/twofactor/manage_action",
            method="POST",
            data={"action": "removercode", "sessionid": sessionid},
        )
        response = await steam.request(
            url="https://store.steampowered.com/twofactor/manage_remove_revocation_code",
            method="POST",
            data={"revocation_code": revocation_code, "sessionid": sessionid},
        )

        await task_manager.set_step(task_id, 3, 3, "Готово", acc_id=account["id"])
        logger.success(f"[remove_guard] {login}: Guard removed")
    finally:
        await close_steam(steam)


async def generate_2fa(account: dict, params: dict, task_id: str = "") -> None:
    """Generate and log a 2FA code for an account."""
    shared_secret = account.get("shared_secret", "")
    if not shared_secret:
        raise ValueError("No shared_secret for this account")

    code = generate_2fa_code(shared_secret)
    logger.debug(f"[generate_2fa] {account['login']}: code = {code}")
