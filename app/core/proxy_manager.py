import random

import aiohttp
from aiohttp_socks import ProxyConnector
from loguru import logger

from app.database import get_db


def build_proxy_url(address: str, protocol: str) -> str:
    """Convert stored address to standard proxy URL (proto://login:pass@ip:port).

    The frontend always normalizes addresses to login:pass@ip:port (or plain ip:port),
    so we just prepend the scheme.
    """
    if "://" in address:
        return address
    scheme = protocol if protocol in ("socks5", "socks4") else "http"
    return f"{scheme}://{address}"


class ProxyManager:
    def __init__(self) -> None:
        self._proxies: list[dict] = []
        self._index: int = 0

    async def load(self) -> None:
        db = await get_db()
        cursor = await db.execute(
            "SELECT * FROM proxies WHERE is_alive = 1 ORDER BY fail_count ASC"
        )
        self._proxies = [dict(r) for r in await cursor.fetchall()]
        logger.info(f"Loaded {len(self._proxies)} alive proxies")

    def get_next(self) -> dict | None:
        if not self._proxies:
            return None
        proxy = self._proxies[self._index % len(self._proxies)]
        self._index += 1
        return proxy

    def get_random(self) -> dict | None:
        if not self._proxies:
            return None
        return random.choice(self._proxies)

    def get_connector(self, proxy: dict | None = None) -> aiohttp.TCPConnector | ProxyConnector:
        if proxy is None:
            return aiohttp.TCPConnector()
        url = build_proxy_url(proxy["address"], proxy.get("protocol", "http"))
        return ProxyConnector.from_url(url, ssl=False)

    async def mark_failed(self, proxy_id: int) -> None:
        db = await get_db()
        await db.execute(
            "UPDATE proxies SET fail_count = fail_count + 1, last_checked = datetime('now') WHERE id = ?",
            (proxy_id,),
        )
        await db.execute(
            "UPDATE proxies SET is_alive = 0 WHERE id = ? AND fail_count >= 5",
            (proxy_id,),
        )
        await db.commit()

    async def mark_alive(self, proxy_id: int) -> None:
        db = await get_db()
        await db.execute(
            "UPDATE proxies SET fail_count = 0, is_alive = 1, last_checked = datetime('now') WHERE id = ?",
            (proxy_id,),
        )
        await db.commit()

    @property
    def count(self) -> int:
        return len(self._proxies)


proxy_manager = ProxyManager()
