from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

import aiohttp
from aiohttp import ClientSession, ClientTimeout
from loguru import logger

from app.core.exceptions import SteamAuthError
from app.core.proxy_manager import proxy_manager
from pysteamauth.base.request import BaseRequestStrategy, DEFAULT_REQUEST_TIMEOUT


class ProxyRequestStrategy(BaseRequestStrategy):
    """Request strategy that routes traffic through a proxy connector."""

    def __init__(self, connector: aiohttp.BaseConnector):
        super().__init__()
        self._proxy_connector = connector

    def _create_session(self) -> ClientSession:
        return ClientSession(
            connector=self._proxy_connector,
            timeout=DEFAULT_REQUEST_TIMEOUT,
        )


def read_mafile_data(account: dict) -> dict | None:
    """Read and parse the account's mafile JSON from disk."""
    mafile_path = account.get("mafile_path")
    if not mafile_path:
        return None
    try:
        return json.loads(Path(mafile_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning(f"Failed to read mafile for {account.get('login', '?')}: {exc}")
        return None


async def _resolve_proxy(account: dict) -> dict | None:
    """Determine proxy dict {address, protocol} for the account."""
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


async def create_steam_session(account: dict):
    """Create an authenticated Steam session for an account."""
    try:
        from pysteamauth.auth import Steam
    except ImportError:
        raise SteamAuthError("pysteamauth not installed: pip install pysteamauth")

    proxy = await _resolve_proxy(account)
    request_strategy = None
    if proxy:
        connector = proxy_manager.get_connector(proxy)
        request_strategy = ProxyRequestStrategy(connector)
        logger.debug(f"Using proxy {proxy['protocol']}://{proxy['address']} for {account['login']}")

    mafile = read_mafile_data(account)

    shared_secret = account.get("shared_secret", "")
    identity_secret = account.get("identity_secret", "")
    device_id = None
    steamid = None

    if mafile:
        shared_secret = mafile.get("shared_secret", shared_secret)
        identity_secret = mafile.get("identity_secret", identity_secret)
        device_id = mafile.get("device_id")
        steamid_raw = (mafile.get("Session") or {}).get("SteamID") or 0
        steamid = int(steamid_raw) or None

    steam = Steam(
        login=account["login"],
        password=account["password"],
        shared_secret=shared_secret,
        identity_secret=identity_secret,
        device_id=device_id,
        steamid=steamid,
        request_strategy=request_strategy,
    )

    try:
        await steam.login_to_steam()
    except Exception as exc:
        await close_steam(steam)
        exc_str = str(exc)
        # Pydantic ValidationError from pysteamauth = Steam rejected login
        if "validation error" in exc_str.lower() and "FinalizeLoginStatus" in exc_str:
            # Extract the raw response dict from the error
            m = __import__("re").search(r"input_value=(\{[^}]+\})", exc_str)
            raw = m.group(1) if m else ""
            logger.error(f"Auth failed for {account['login']}: Steam rejected login: {raw}")
            raise SteamAuthError(f"Login failed: Steam rejected credentials ({raw})")
        logger.error(f"Auth failed for {account['login']}: {exc}")
        raise SteamAuthError(f"Login failed: {exc}")

    return steam


async def close_steam(steam) -> None:
    """Close the underlying aiohttp session and proxy connector of a pysteamauth Steam object."""
    requests = getattr(steam, "_requests", None)
    if requests is None:
        return
    session = getattr(requests, "_session", None)
    if session is not None and not getattr(session, "closed", True):
        try:
            await session.close()
        except Exception:
            pass
    requests._session = None

    connector = getattr(requests, "_proxy_connector", None)
    if connector is not None and not getattr(connector, "closed", True):
        try:
            await connector.close()
        except Exception:
            pass


def extract_session_cookies(steam) -> str | None:
    """Extract session cookies from a pysteamauth Steam object as JSON string.

    Returns JSON string of cookies list, or None if extraction fails.
    """
    try:
        _req = getattr(steam, "_requests", None)
        _sess = getattr(_req, "_session", None) if _req else None
        if not _sess or not hasattr(_sess, "cookie_jar"):
            return None
        all_cookies = []
        for c in _sess.cookie_jar:
            all_cookies.append({
                "name": c.key,
                "value": c.value,
                "domain": c.get("domain", ""),
                "path": c.get("path", "/"),
                "secure": str(c.get("secure", "")).lower() == "true" or c.get("secure") is True,
                "httpOnly": str(c.get("httponly", "")).lower() == "true" or c.get("httponly") is True,
            })
        return json.dumps(all_cookies)
    except Exception:
        return None

def update_mafile_tokens(steam, account: dict) -> bool:
    """Extract fresh tokens from a logged-in steam session and update the .mafile on disk."""
    mafile_path = account.get("mafile_path")
    if not mafile_path:
        return False

    try:
        mafile = json.loads(Path(mafile_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False

    _req = getattr(steam, "_requests", None)
    _sess = getattr(_req, "_session", None) if _req else None
    if not _sess or not hasattr(_sess, "cookie_jar"):
        return False

    access_token = None
    session_id = None
    steam_id = str(getattr(steam, "_steamid", "") or "")

    for c in _sess.cookie_jar:
        if c.key == "steamLoginSecure" and c.value:
            raw = __import__("urllib.parse", fromlist=["unquote"]).unquote(c.value)
            if "||" in raw:
                parts = raw.split("||", 1)
                if not steam_id:
                    steam_id = parts[0]
                access_token = parts[1]
        elif c.key == "sessionid" and c.value:
            session_id = c.value

    if not access_token:
        return False

    session = mafile.setdefault("Session", {})
    session["AccessToken"] = access_token
    if session_id:
        session["SessionID"] = session_id
    if steam_id:
        session["SteamID"] = steam_id
        session["SteamLoginSecure"] = f"{steam_id}%7C%7C{access_token}"

    refresh_token = getattr(steam, "_refresh_token", None)
    if refresh_token:
        session["RefreshToken"] = refresh_token

    try:
        Path(mafile_path).write_text(json.dumps(mafile, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.debug(f"[auth] Updated mafile tokens: {mafile_path}")
        return True
    except OSError as e:
        logger.warning(f"[auth] Failed to update mafile: {e}")
        return False


async def check_cookies_alive(cookies_json: str, proxy: dict | None = None) -> bool:
    """Check if Steam session cookies are still valid.

    Makes a lightweight request to Steam's clientjstoken endpoint.
    Returns True if logged in, False otherwise.
    """
    try:
        cookies = json.loads(cookies_json)
        jar = aiohttp.CookieJar(unsafe=True)
        for c in cookies:
            jar.update_cookies(
                {c["name"]: c["value"]},
                response_url=__import__("yarl").URL(f"https://{c.get('domain', '.steamcommunity.com').lstrip('.')}"),
            )
        connector = proxy_manager.get_connector(proxy) if proxy else None
        async with aiohttp.ClientSession(cookie_jar=jar, connector=connector) as session:
            async with session.get(
                "https://steamcommunity.com/chat/clientjstoken",
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status != 200:
                    return False
                data = await resp.json(content_type=None)
                return bool(data.get("logged_in"))
    except Exception:
        return False


async def raw_request(steam, url: str, method: str = "GET", **kwargs) -> aiohttp.ClientResponse:
    """Low-level request returning raw aiohttp.ClientResponse (for redirects, etc.)."""
    from yarl import URL

    host = URL(url).host or ""
    cookies = await steam.cookies(host)
    return await steam._requests.request(url=url, method=method, cookies=cookies, **kwargs)
