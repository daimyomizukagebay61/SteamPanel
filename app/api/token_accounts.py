"""CRUD and validate endpoints for token accounts."""

import asyncio

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.database import get_db
from app.core.task_manager import task_manager
from app.models import TokenAccountCreate, TokenAccountOut, TokenAccountUpdate

router = APIRouter(prefix="/api/token-accounts", tags=["token-accounts"])


@router.get("", response_model=list[TokenAccountOut])
async def list_tokens():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM token_accounts ORDER BY id DESC")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/{account_id}", response_model=TokenAccountOut)
async def get_token(account_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM token_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.post("", response_model=TokenAccountOut, status_code=201)
async def create_token(account: TokenAccountCreate):
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO token_accounts (login, token, steam_id, proxy, notes) VALUES (?, ?, ?, ?, ?)",
        (account.login, account.token, account.steam_id, account.proxy, account.notes),
    )
    await db.commit()
    new_cursor = await db.execute(
        "SELECT * FROM token_accounts WHERE id = ?", (cursor.lastrowid,)
    )
    return dict(await new_cursor.fetchone())


@router.put("/{account_id}", response_model=TokenAccountOut)
async def update_token(account_id: int, account: TokenAccountUpdate):
    db = await get_db()
    fields = {k: v for k, v in account.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    fields["updated_at"] = "datetime('now')"
    set_clause = ", ".join(
        f"{k} = datetime('now')" if k == "updated_at" else f"{k} = ?"
        for k in fields
    )
    values = [v for k, v in fields.items() if k != "updated_at"]
    values.append(account_id)
    await db.execute(f"UPDATE token_accounts SET {set_clause} WHERE id = ?", values)
    await db.commit()
    cursor = await db.execute("SELECT * FROM token_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.delete("/{account_id}", status_code=204)
async def delete_token(account_id: int):
    db = await get_db()
    await db.execute("DELETE FROM token_accounts WHERE id = ?", (account_id,))
    await db.commit()


@router.post("/delete-bulk")
async def delete_token_bulk(data: dict):
    ids: list[int] = data.get("ids", [])
    if not ids:
        return {"deleted": 0}
    db = await get_db()
    placeholders = ",".join("?" for _ in ids)
    await db.execute(f"DELETE FROM token_accounts WHERE id IN ({placeholders})", ids)
    await db.commit()
    return {"deleted": len(ids)}


@router.post("/import")
async def import_tokens(data: dict):
    """Bulk import: one token per line, optionally 'login:token'."""
    lines: list[str] = data.get("lines", [])
    imported = 0
    skipped = 0
    errors: list[str] = []

    db = await get_db()
    for raw in lines:
        line = raw.strip()
        if not line:
            skipped += 1
            continue
        login = None
        token = line
        if ":" in line:
            parts = line.split(":", 1)
            login, token = parts[0].strip(), parts[1].strip()
        if not token:
            skipped += 1
            continue
        try:
            await db.execute(
                "INSERT OR IGNORE INTO token_accounts (login, token) VALUES (?, ?)",
                (login, token),
            )
            imported += 1
        except Exception as exc:
            errors.append(f"{token[:20]}: {exc}")
    await db.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors}


@router.post("/validate")
async def validate_tokens(data: dict):
    """Submit validation task for selected token accounts."""
    ids: list[int] = data.get("account_ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="No account IDs provided")

    db = await get_db()
    placeholders = ",".join("?" for _ in ids)
    cursor = await db.execute(
        f"SELECT * FROM token_accounts WHERE id IN ({placeholders})", ids
    )
    accounts = [dict(r) for r in await cursor.fetchall()]
    if not accounts:
        raise HTTPException(status_code=404, detail="No accounts found")

    task_id = await task_manager.submit(
        task_type="token_validate",
        accounts=accounts,
        params={},
    )
    logger.info(f"token_validate submitted for {len(accounts)} accounts → task {task_id}")
    return {"task_id": task_id, "accounts_count": len(accounts)}


@router.post("/{account_id}/browser")
async def open_token_browser(account_id: int):
    """Open Chrome browser with saved session cookies for a token account."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM token_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")

    account = dict(row)
    if not account.get("session_cookies"):
        raise HTTPException(status_code=400, detail="No session cookies. Validate the account first.")

    from app.services.steam_auth import check_cookies_alive, _resolve_proxy
    from app.config import read_validation_settings

    proxy = await _resolve_proxy(account)
    alive = await check_cookies_alive(account["session_cookies"], proxy)
    if not alive:
        val_settings = read_validation_settings()
        if val_settings.get("auto_revalidate_browser"):
            task_id = await task_manager.submit(
                task_type="token_validate",
                accounts=[account],
                params={},
            )
            logger.info(f"Cookies dead for token account {account_id}, auto-revalidating → task {task_id}")
            return {"status": "revalidating", "message": "Cookies expired. Re-validating...", "task_id": task_id}
        raise HTTPException(status_code=400, detail="Session cookies expired. Re-validate the account.")

    from app.services.browser_login import open_browser_with_cookies

    async def _run():
        try:
            await open_browser_with_cookies(account)
        except Exception as exc:
            logger.error(f"Browser open failed for {account.get('login', account_id)}: {exc}")

    asyncio.create_task(_run())
    return {"status": "ok", "message": "Browser opening..."}


@router.post("/assign-proxies")
async def token_assign_proxies():
    """Round-robin assign proxies to token accounts that don't have one."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT address FROM proxies ORDER BY id")
    proxies = [r["address"] for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute(
        "SELECT id FROM token_accounts WHERE proxy IS NULL OR proxy = '' ORDER BY id"
    )
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        await db.execute(
            "UPDATE token_accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxies[i % len(proxies)], acc_id),
        )
    await db.commit()
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/reassign-proxies")
async def token_reassign_proxies():
    """Round-robin reassign proxies to ALL token accounts."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT address FROM proxies ORDER BY id")
    proxies = [r["address"] for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute("SELECT id FROM token_accounts ORDER BY id")
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        await db.execute(
            "UPDATE token_accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxies[i % len(proxies)], acc_id),
        )
    await db.commit()
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/clear-proxies")
async def token_clear_proxies():
    """Remove proxy from all token accounts."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE token_accounts SET proxy = NULL, updated_at = datetime('now') WHERE proxy IS NOT NULL AND proxy != ''"
    )
    await db.commit()
    return {"cleared": cursor.rowcount}
