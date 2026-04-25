"""Steam mobile confirmations — fetch, accept, deny trade/market confirmations."""

import base64
import hashlib
import hmac
import json
import struct
import time
from pathlib import Path

import aiohttp
from yarl import URL
from loguru import logger


COMMUNITY_BASE = "https://steamcommunity.com"
MOBILE_USER_AGENT = "Dalvik/2.1.0 (Linux; U; Android 9; Valve Steam App Version/3)"

CONF_TYPES = {
    0: "Invalid",
    1: "Test",
    2: "Trade",
    3: "MarketListing",
    4: "FeatureOptOut",
    5: "PhoneNumberChange",
    6: "AccountRecovery",
}


def _decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64))


def _is_token_expired(token: str, margin: int = 60) -> bool:
    """Check if a JWT access token is expired (with safety margin in seconds)."""
    try:
        payload = _decode_jwt_payload(token)
        return payload.get("exp", 0) < int(time.time()) + margin
    except Exception:
        return True


async def _resolve_proxy(account: dict):
    """Resolve proxy for an account (same logic as steam_auth)."""
    from app.core.proxy_manager import proxy_manager

    proxy_address = account.get("proxy")
    if proxy_address:
        from app.database import get_db
        db = await get_db()
        cursor = await db.execute(
            "SELECT protocol FROM proxies WHERE address = ?", (proxy_address,)
        )
        row = await cursor.fetchone()
        protocol = row["protocol"] if row else "http"
        return {"address": proxy_address, "protocol": protocol}
    if proxy_manager.count > 0:
        return proxy_manager.get_next()
    return None


async def _refresh_access_token(
    refresh_token: str, steam_id: str, connector: aiohttp.BaseConnector | None = None,
) -> str | None:
    """Use RefreshToken to get a fresh AccessToken via Steam protobuf API."""
    try:
        from pysteamauth.pb2.steammessages_auth.steamclient_pb2 import (
            CAuthentication_AccessToken_GenerateForApp_Request,
            CAuthentication_AccessToken_GenerateForApp_Response,
        )
    except ImportError:
        logger.warning("[confirmations] protobuf classes not available for token refresh")
        return None

    msg = CAuthentication_AccessToken_GenerateForApp_Request()
    msg.refresh_token = refresh_token
    msg.steamid = int(steam_id)
    encoded = base64.b64encode(msg.SerializeToString()).decode()

    kw: dict = {"headers": {"User-Agent": MOBILE_USER_AGENT}, "timeout": aiohttp.ClientTimeout(total=15)}
    if connector:
        kw["connector"] = connector

    try:
        async with aiohttp.ClientSession(**kw) as http:
            async with http.post(
                "https://api.steampowered.com/IAuthenticationService/GenerateAccessTokenForApp/v1/",
                data={"input_protobuf_encoded": encoded},
            ) as resp:
                eresult = resp.headers.get("x-eresult", "?")
                raw = await resp.read()
                if raw:
                    resp_msg = CAuthentication_AccessToken_GenerateForApp_Response()
                    resp_msg.ParseFromString(raw)
                    if resp_msg.access_token:
                        logger.info(f"[confirmations] Refreshed AccessToken for SteamID {steam_id}")
                        return resp_msg.access_token
                logger.warning(f"[confirmations] Token refresh failed for SteamID {steam_id}: eresult={eresult}")
    except Exception as e:
        logger.error(f"[confirmations] Token refresh error for SteamID {steam_id}: {e}")
    return None


def _has_mobile_audience(token: str) -> bool:
    """Check if JWT token has 'mobile' in its audience claim."""
    try:
        payload = _decode_jwt_payload(token)
        aud = payload.get("aud", [])
        return "mobile" in aud
    except Exception:
        return False


async def _ensure_valid_access_token(account: dict, mafile: dict) -> str:
    """Return a valid AccessToken, refreshing if expired. Updates mafile on disk."""
    session = mafile.get("Session", {})
    access_token = session.get("AccessToken", "")
    refresh_token = session.get("RefreshToken", "")
    steam_id = str(session.get("SteamID", ""))

    needs_refresh = (
        not access_token
        or _is_token_expired(access_token)
        or not _has_mobile_audience(access_token)
    )

    if not needs_refresh:
        return access_token

    if not refresh_token:
        raise ValueError("AccessToken expired and no RefreshToken available")

    if _is_token_expired(refresh_token, margin=0):
        raise ValueError("Both AccessToken and RefreshToken are expired — re-authentication required")

    from app.core.proxy_manager import proxy_manager
    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else None

    new_token = await _refresh_access_token(refresh_token, steam_id, connector)
    if not new_token:
        raise ValueError(
            "Failed to refresh AccessToken — session may be revoked or proxy IP mismatch"
        )

    # Update mafile on disk
    mafile["Session"]["AccessToken"] = new_token
    mafile["Session"]["SteamLoginSecure"] = f"{steam_id}%7C%7C{new_token}"
    mafile_path = account.get("mafile_path")
    if mafile_path:
        try:
            Path(mafile_path).write_text(json.dumps(mafile, indent=2), encoding="utf-8")
            logger.debug(f"[confirmations] Updated mafile on disk: {mafile_path}")
        except OSError as e:
            logger.warning(f"[confirmations] Could not update mafile: {e}")

    return new_token


async def _get_steam_server_time() -> int:
    """Query Steam server time for HMAC generation."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://api.steampowered.com/ITwoFactorService/QueryTime/v0001",
                data={"steamid": "0"},
                headers={"User-Agent": MOBILE_USER_AGENT},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return int(data.get("response", {}).get("server_time", time.time()))
    except Exception:
        pass
    return int(time.time())


def _generate_confirmation_hash(identity_secret: str, steam_time: int, tag: str) -> str:
    """HMAC-SHA1(identity_secret, time_bytes + tag_bytes) → Base64."""
    key = base64.b64decode(identity_secret)
    msg = struct.pack(">Q", steam_time)
    tag_bytes = tag.encode("ascii")
    msg += tag_bytes[:32]
    mac = hmac.new(key, msg, hashlib.sha1).digest()
    return base64.b64encode(mac).decode()


def _build_query_params(
    device_id: str, steam_id: str, identity_secret: str, steam_time: int, tag: str
) -> dict:
    """Build confirmation query parameters."""
    return {
        "p": device_id,
        "a": steam_id,
        "k": _generate_confirmation_hash(identity_secret, steam_time, tag),
        "t": str(steam_time),
        "m": "react",
        "tag": tag,
    }


def _build_cookies(steam_id: str, access_token: str, session_id: str) -> dict:
    """Build mobile cookies for confirmation requests."""
    steam_login_secure = f"{steam_id}%7C%7C{access_token}"
    return {
        "steamLoginSecure": steam_login_secure,
        "sessionid": session_id,
        "mobileClient": "android",
        "mobileClientVersion": "777777 3.7.2",
        "Steam_Language": "english",
    }


async def fetch_confirmations(account: dict) -> list[dict]:
    """Fetch pending confirmations for an account.

    Returns list of confirmation dicts with id, nonce, type, headline, summary etc.
    """
    from app.services.steam_auth import read_mafile_data
    from app.core.proxy_manager import proxy_manager

    mafile = read_mafile_data(account)
    if not mafile:
        raise ValueError("No mafile data for this account")

    identity_secret = mafile.get("identity_secret", "")
    device_id = mafile.get("device_id", "")
    session = mafile.get("Session", {})
    steam_id = str(session.get("SteamID", ""))
    session_id = session.get("SessionID", "")

    if not identity_secret or not steam_id:
        raise ValueError("Missing identity_secret or SteamID in mafile")

    access_token = await _ensure_valid_access_token(account, mafile)

    if not device_id:
        device_id = f"android:{steam_id}"

    if not session_id:
        import secrets
        session_id = secrets.token_hex(12)

    steam_time = await _get_steam_server_time()
    params = _build_query_params(device_id, steam_id, identity_secret, steam_time, "conf")
    cookies = _build_cookies(steam_id, access_token, session_id)

    url = f"{COMMUNITY_BASE}/mobileconf/getlist"

    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else aiohttp.TCPConnector()

    async with aiohttp.ClientSession(
        headers={"User-Agent": MOBILE_USER_AGENT},
        cookie_jar=aiohttp.CookieJar(unsafe=True),
        connector=connector,
    ) as http:
        for domain in ["steamcommunity.com", "store.steampowered.com"]:
            for k, v in cookies.items():
                http.cookie_jar.update_cookies({k: v}, URL(f"https://{domain}"))

        async with http.get(url, params=params) as resp:
            if resp.status != 200:
                raise ValueError(f"HTTP {resp.status} from Steam confirmations API")
            data = await resp.json()

    if not data.get("success"):
        if data.get("needsauth"):
            raise ValueError("Session expired — needs re-authentication")
        detail = data.get("detail", "")
        message = data.get("message", "")
        login = account.get("login", "?")
        logger.warning(f"[confirmations] {login}: {message or 'unknown error'}")

        if "authenticator" in message.lower() or "authenticator" in detail.lower():
            raise ValueError(
                "Invalid authenticator — mafile secrets may be outdated. "
                "Re-link Steam Guard or re-import a fresh mafile."
            )
        if detail:
            raise ValueError(f"Steam: {detail}")
        if message:
            raise ValueError(f"Steam: {message}")
        raise ValueError("Steam rejected the request — likely expired session or invalid mafile tokens")

    confirmations = []
    for conf in data.get("conf", []):
        confirmations.append({
            "id": str(conf.get("id", "")),
            "nonce": str(conf.get("nonce", "")),
            "type": conf.get("type", 0),
            "type_name": CONF_TYPES.get(conf.get("type", 0), "Unknown"),
            "creator_id": str(conf.get("creator_id", "")),
            "headline": conf.get("headline", ""),
            "summary": [conf.get("summary", "")] if isinstance(conf.get("summary"), str) else conf.get("summary", []),
            "accept": conf.get("accept", "Accept"),
            "cancel": conf.get("cancel", "Cancel"),
            "icon": conf.get("icon", ""),
        })

    logger.info(f"[confirmations] {account.get('login', '?')}: fetched {len(confirmations)} confirmations")
    return confirmations


async def respond_to_confirmation(
    account: dict, confirmation_ids: list[str], confirmation_nonces: list[str], accept: bool
) -> bool:
    """Accept or deny one or more confirmations.

    Uses multiajaxop for batch operations, ajaxop for single.
    """
    from app.services.steam_auth import read_mafile_data
    from app.core.proxy_manager import proxy_manager

    mafile = read_mafile_data(account)
    if not mafile:
        raise ValueError("No mafile data")

    identity_secret = mafile.get("identity_secret", "")
    device_id = mafile.get("device_id", "")
    session = mafile.get("Session", {})
    steam_id = str(session.get("SteamID", ""))
    session_id = session.get("SessionID", "")

    if not identity_secret or not steam_id:
        raise ValueError("Missing secrets in mafile")

    access_token = await _ensure_valid_access_token(account, mafile)

    if not device_id:
        device_id = f"android:{steam_id}"
    if not session_id:
        import secrets
        session_id = secrets.token_hex(12)

    op = "allow" if accept else "cancel"
    tag = "accept" if accept else "reject"
    steam_time = await _get_steam_server_time()
    params = _build_query_params(device_id, steam_id, identity_secret, steam_time, tag)
    cookies = _build_cookies(steam_id, access_token, session_id)

    proxy = await _resolve_proxy(account)
    connector = proxy_manager.get_connector(proxy) if proxy else aiohttp.TCPConnector()

    async with aiohttp.ClientSession(
        headers={"User-Agent": MOBILE_USER_AGENT},
        cookie_jar=aiohttp.CookieJar(unsafe=True),
        connector=connector,
    ) as http:
        for domain in ["steamcommunity.com", "store.steampowered.com"]:
            for k, v in cookies.items():
                http.cookie_jar.update_cookies({k: v}, URL(f"https://{domain}"))

        if len(confirmation_ids) == 1:
            url = f"{COMMUNITY_BASE}/mobileconf/ajaxop"
            query = {
                "op": op,
                **params,
                "cid": confirmation_ids[0],
                "ck": confirmation_nonces[0],
            }
            async with http.get(url, params=query) as resp:
                data = await resp.json()
        else:
            url = f"{COMMUNITY_BASE}/mobileconf/multiajaxop"
            form_data = {"op": op}
            form_data.update(params)
            for cid in confirmation_ids:
                form_data[f"cid[]"] = cid
            for ck in confirmation_nonces:
                form_data[f"ck[]"] = ck

            payload = aiohttp.FormData()
            payload.add_field("op", op)
            for k, v in params.items():
                payload.add_field(k, str(v))
            for cid in confirmation_ids:
                payload.add_field("cid[]", cid)
            for ck in confirmation_nonces:
                payload.add_field("ck[]", ck)

            async with http.post(url, data=payload) as resp:
                data = await resp.json()

    success = data.get("success", False)
    action_word = "accepted" if accept else "denied"
    logger.info(f"[confirmations] {account.get('login', '?')}: {action_word} {len(confirmation_ids)} confirmations — success={success}")
    return success
