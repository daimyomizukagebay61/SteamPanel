"""Steam auto-accept login confirmations — ported from legacy/steam_auto_accept_logins.py."""

import asyncio
import base64
import hashlib
import hmac
import struct

import aiohttp
import rsa
from loguru import logger

from pysteamauth.pb2.steammessages_auth.steamclient_pb2 import (
    CAuthentication_GetPasswordRSAPublicKey_Request,
    CAuthentication_GetPasswordRSAPublicKey_Response,
    CAuthentication_BeginAuthSessionViaCredentials_Request,
    CAuthentication_BeginAuthSessionViaCredentials_Response,
    CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request,
    CAuthentication_PollAuthSessionStatus_Request,
    CAuthentication_PollAuthSessionStatus_Response,
    CAuthentication_GetAuthSessionsForAccount_Response,
    CAuthentication_GetAuthSessionInfo_Request,
    CAuthentication_GetAuthSessionInfo_Response,
    CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request,
    CAuthentication_UpdateAuthSessionWithMobileConfirmation_Response,
    EAuthTokenPlatformType,
    EAuthSessionGuardType,
)

BASE_URL = "https://api.steampowered.com"
HEADERS = {"User-Agent": "okhttp/4.9.2", "Cookie": "Steam_Language=english"}


def _generate_2fa_code(shared_secret: str, server_time: int | None = None) -> str:
    """Generate a Steam Guard TOTP code from shared_secret."""
    import time as _time

    if server_time is None:
        server_time = int(_time.time())
    key = base64.b64decode(shared_secret)
    msg = struct.pack(">Q", server_time // 30)
    mac = hmac.new(key, msg, hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    code_int = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    chars = "23456789BCDFGHJKMNPQRTVWXY"
    code = ""
    for _ in range(5):
        code += chars[code_int % len(chars)]
        code_int //= len(chars)
    return code


def _confirmation_signature(shared_secret: str, client_id: int, steamid: int) -> bytes:
    """HMAC-SHA256 signature for login confirmation (version=1 + client_id + steamid)."""
    key = base64.b64decode(shared_secret)
    data = struct.pack("<HQQ", 1, client_id, steamid)
    return hmac.new(key, data, hashlib.sha256).digest()


async def mobile_login(session: aiohttp.ClientSession, account: dict) -> str | None:
    """Perform mobile login flow, return access_token or None."""
    login = account["login"]
    password = account["password"]
    shared_secret = account.get("shared_secret", "")

    try:
        # GetPasswordRSAPublicKey
        req = CAuthentication_GetPasswordRSAPublicKey_Request()
        req.account_name = login
        encoded = base64.b64encode(req.SerializeToString()).decode()

        async with session.get(
            f"{BASE_URL}/IAuthenticationService/GetPasswordRSAPublicKey/v1",
            params={"origin": "SteamMobile", "input_protobuf_encoded": encoded},
            headers=HEADERS,
        ) as resp:
            if resp.status != 200:
                logger.error(f"[auto-accept] RSA key failed for {login}: HTTP {resp.status}")
                return None
            rsa_resp = CAuthentication_GetPasswordRSAPublicKey_Response.FromString(await resp.read())

        pub_key = rsa.PublicKey(int(rsa_resp.publickey_mod, 16), int(rsa_resp.publickey_exp, 16))
        encrypted_pw = base64.b64encode(rsa.encrypt(password.encode(), pub_key)).decode()

        # BeginAuthSession
        begin = CAuthentication_BeginAuthSessionViaCredentials_Request()
        begin.account_name = login
        begin.encrypted_password = encrypted_pw
        begin.encryption_timestamp = rsa_resp.timestamp
        begin.platform_type = EAuthTokenPlatformType.k_EAuthTokenPlatformType_MobileApp
        begin.device_friendly_name = "Android Device"
        begin.persistence = 1

        data = aiohttp.FormData()
        data.add_field("input_protobuf_encoded", base64.b64encode(begin.SerializeToString()).decode())

        async with session.post(
            f"{BASE_URL}/IAuthenticationService/BeginAuthSessionViaCredentials/v1",
            data=data,
            headers=HEADERS,
        ) as resp:
            if resp.status != 200:
                logger.error(f"[auto-accept] BeginAuth failed for {login}: HTTP {resp.status}")
                return None
            begin_resp = CAuthentication_BeginAuthSessionViaCredentials_Response.FromString(await resp.read())

        # Send 2FA code
        if shared_secret:
            code = _generate_2fa_code(shared_secret)
            upd = CAuthentication_UpdateAuthSessionWithSteamGuardCode_Request()
            upd.client_id = begin_resp.client_id
            upd.steamid = begin_resp.steamid
            upd.code = code
            upd.code_type = EAuthSessionGuardType.k_EAuthSessionGuardType_DeviceCode

            data = aiohttp.FormData()
            data.add_field("input_protobuf_encoded", base64.b64encode(upd.SerializeToString()).decode())

            async with session.post(
                f"{BASE_URL}/IAuthenticationService/UpdateAuthSessionWithSteamGuardCode/v1",
                data=data,
                headers=HEADERS,
            ) as resp:
                if resp.status != 200:
                    logger.error(f"[auto-accept] 2FA submit failed for {login}: HTTP {resp.status}")
                    return None

        # PollAuthSessionStatus
        poll = CAuthentication_PollAuthSessionStatus_Request()
        poll.client_id = begin_resp.client_id
        poll.request_id = begin_resp.request_id

        data = aiohttp.FormData()
        data.add_field("input_protobuf_encoded", base64.b64encode(poll.SerializeToString()).decode())

        async with session.post(
            f"{BASE_URL}/IAuthenticationService/PollAuthSessionStatus/v1",
            data=data,
            headers=HEADERS,
        ) as resp:
            if resp.status != 200:
                logger.error(f"[auto-accept] Poll failed for {login}: HTTP {resp.status}")
                return None
            poll_resp = CAuthentication_PollAuthSessionStatus_Response.FromString(await resp.read())

        if not poll_resp.access_token:
            logger.error(f"[auto-accept] No access_token for {login}")
            return None

        logger.success(f"[auto-accept] Mobile login OK for {login}")
        return poll_resp.access_token

    except Exception as exc:
        logger.error(f"[auto-accept] Login error for {login}: {exc}")
        return None


async def get_pending_sessions(session: aiohttp.ClientSession, access_token: str) -> list[int] | None:
    """Get pending auth session client_ids. Returns None on 401 (token expired)."""
    try:
        async with session.get(
            f"{BASE_URL}/IAuthenticationService/GetAuthSessionsForAccount/v1",
            params={
                "access_token": access_token,
                "origin": "SteamMobile",
                "input_protobuf_encoded": "",
            },
            headers=HEADERS,
        ) as resp:
            if resp.status == 401:
                return None
            if resp.status != 200:
                return []
            data = CAuthentication_GetAuthSessionsForAccount_Response.FromString(await resp.read())
            return list(data.client_ids)
    except Exception as exc:
        logger.warning(f"[auto-accept] get_pending_sessions error: {exc}")
        return []


async def confirm_session(
    session: aiohttp.ClientSession,
    access_token: str,
    account: dict,
    client_id: int,
) -> bool:
    """Confirm a pending login session."""
    steam_id = int(account.get("steam_id", 0))
    shared_secret = account.get("shared_secret", "")
    if not steam_id or not shared_secret:
        return False

    try:
        signature = _confirmation_signature(shared_secret, client_id, steam_id)

        msg = CAuthentication_UpdateAuthSessionWithMobileConfirmation_Request()
        msg.version = 1
        msg.client_id = client_id
        msg.steamid = steam_id
        msg.signature = signature
        msg.confirm = True
        msg.persistence = 1

        data = aiohttp.FormData()
        data.add_field("input_protobuf_encoded", base64.b64encode(msg.SerializeToString()).decode())

        async with session.post(
            f"{BASE_URL}/IAuthenticationService/UpdateAuthSessionWithMobileConfirmation/v1",
            params={"access_token": access_token},
            data=data,
            headers=HEADERS,
        ) as resp:
            if resp.status == 200:
                logger.success(f"[auto-accept] Confirmed login for {account['login']} (client_id={client_id})")
                return True
            logger.warning(f"[auto-accept] Confirm failed for {account['login']}: HTTP {resp.status}")
            return False
    except Exception as exc:
        logger.error(f"[auto-accept] Confirm error for {account['login']}: {exc}")
        return False
