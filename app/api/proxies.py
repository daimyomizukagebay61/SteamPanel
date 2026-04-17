import asyncio

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.database import get_db
from app.models import ProxyCreate, ProxyOut

router = APIRouter(prefix="/api/proxies", tags=["proxies"])


@router.get("", response_model=list[ProxyOut])
async def list_proxies():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM proxies ORDER BY id")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("", response_model=ProxyOut, status_code=201)
async def add_proxy(proxy: ProxyCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO proxies (address, protocol) VALUES (?, ?)",
            (proxy.address, proxy.protocol),
        )
        await db.commit()
    except Exception:
        raise HTTPException(status_code=409, detail="Proxy already exists")

    new_cursor = await db.execute(
        "SELECT * FROM proxies WHERE id = ?", (cursor.lastrowid,)
    )
    return dict(await new_cursor.fetchone())


@router.delete("/all", status_code=200)
async def delete_all_proxies():
    db = await get_db()
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM proxies")
    row = await cursor.fetchone()
    count = row["cnt"]
    await db.execute("DELETE FROM proxies")
    await db.commit()
    from app.core.proxy_manager import proxy_manager
    await proxy_manager.load()
    logger.info(f"Deleted all {count} proxies")
    return {"deleted": count}


@router.delete("/{proxy_id}", status_code=204)
async def delete_proxy(proxy_id: int):
    db = await get_db()
    result = await db.execute("DELETE FROM proxies WHERE id = ?", (proxy_id,))
    await db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Proxy not found")


@router.post("/bulk")
async def bulk_add_proxies(proxies: list[ProxyCreate]):
    db = await get_db()
    added = 0
    for p in proxies:
        try:
            await db.execute(
                "INSERT OR IGNORE INTO proxies (address, protocol) VALUES (?, ?)",
                (p.address, p.protocol),
            )
            added += 1
        except Exception:
            pass
    await db.commit()
    logger.info(f"Bulk added {added} proxies")
    return {"added": added}


async def _check_one_proxy(proxy_id: int, address: str, protocol: str) -> dict:
    """Check proxy by making a real HTTP request through it."""
    import aiohttp
    from aiohttp_socks import ProxyConnector
    from app.core.proxy_manager import build_proxy_url

    try:
        proxy_url = build_proxy_url(address, protocol)
        connector = ProxyConnector.from_url(proxy_url, ssl=False)

        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                "https://steamcommunity.com/robots.txt",
                timeout=aiohttp.ClientTimeout(total=3),
            ) as resp:
                alive = resp.status == 200
    except Exception:
        alive = False

    db = await get_db()
    await db.execute(
        "UPDATE proxies SET is_alive = ?, last_checked = datetime('now') WHERE id = ?",
        (int(alive), proxy_id),
    )
    await db.commit()
    return {"id": proxy_id, "alive": alive}


@router.post("/check")
async def check_proxies():
    db = await get_db()
    cursor = await db.execute("SELECT id, address, protocol FROM proxies ORDER BY id")
    rows = await cursor.fetchall()
    if not rows:
        return {"total": 0, "alive": 0, "dead": 0}

    sem = asyncio.Semaphore(300)

    async def limited(row):
        async with sem:
            return await _check_one_proxy(row["id"], row["address"], row["protocol"])

    results = await asyncio.gather(*(limited(r) for r in rows))
    alive_count = sum(1 for r in results if r["alive"])
    return {"total": len(results), "alive": alive_count, "dead": len(results) - alive_count}
