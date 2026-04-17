"""CRUD and validate endpoints for log:pass accounts."""

import csv
import ctypes
import io
import sys

csv.field_size_limit(min(sys.maxsize, ctypes.c_ulong(-1).value // 2))

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.database import get_db
from app.models import (
    LogpassAccountCreate,
    LogpassAccountOut,
    LogpassAccountUpdate,
)
from app.core.task_manager import task_manager

router = APIRouter(prefix="/api/logpass", tags=["logpass"])


@router.get("", response_model=list[LogpassAccountOut])
async def list_logpass():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM logpass_accounts ORDER BY id DESC")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/{account_id}", response_model=LogpassAccountOut)
async def get_logpass(account_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM logpass_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.post("", response_model=LogpassAccountOut, status_code=201)
async def create_logpass(account: LogpassAccountCreate):
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO logpass_accounts (login, password, steam_id, proxy, notes) VALUES (?, ?, ?, ?, ?)",
        (account.login, account.password, account.steam_id, account.proxy, account.notes),
    )
    await db.commit()
    new_cursor = await db.execute(
        "SELECT * FROM logpass_accounts WHERE id = ?", (cursor.lastrowid,)
    )
    return dict(await new_cursor.fetchone())


@router.put("/{account_id}", response_model=LogpassAccountOut)
async def update_logpass(account_id: int, account: LogpassAccountUpdate):
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
    await db.execute(
        f"UPDATE logpass_accounts SET {set_clause} WHERE id = ?", values
    )
    await db.commit()
    cursor = await db.execute("SELECT * FROM logpass_accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.delete("/{account_id}", status_code=204)
async def delete_logpass(account_id: int):
    db = await get_db()
    await db.execute("DELETE FROM logpass_accounts WHERE id = ?", (account_id,))
    await db.commit()


@router.post("/delete-bulk")
async def delete_logpass_bulk(data: dict):
    ids: list[int] = data.get("ids", [])
    if not ids:
        return {"deleted": 0}
    db = await get_db()
    placeholders = ",".join("?" for _ in ids)
    await db.execute(f"DELETE FROM logpass_accounts WHERE id IN ({placeholders})", ids)
    await db.commit()
    return {"deleted": len(ids)}


@router.post("/import")
async def import_logpass(data: dict):
    """Bulk import from plain text (login:pass / login|pass) or CSV with headers."""
    lines: list[str] = data.get("lines", [])
    if not lines:
        return {"imported": 0, "skipped": 0, "errors": []}

    imported = 0
    skipped = 0
    errors: list[str] = []

    db = await get_db()

    async def upsert(login: str, fields: dict):
        """Insert or update by login, works with or without UNIQUE index."""
        cursor = await db.execute(
            "SELECT id FROM logpass_accounts WHERE login = ?", (login,)
        )
        existing = await cursor.fetchone()
        if existing:
            sets = ", ".join(f"{k} = ?" for k in fields)
            vals = list(fields.values()) + [existing["id"]]
            await db.execute(
                f"UPDATE logpass_accounts SET {sets}, updated_at = datetime('now') WHERE id = ?",
                vals,
            )
        else:
            fields["login"] = login
            cols = ", ".join(fields.keys())
            placeholders = ", ".join("?" for _ in fields)
            await db.execute(
                f"INSERT INTO logpass_accounts ({cols}) VALUES ({placeholders})",
                list(fields.values()),
            )

    # Detect CSV: first line looks like a header row
    first = lines[0].strip().lower()
    is_csv = first.startswith("login,") or first.startswith("login;")

    try:
        if is_csv:
            text = "\n".join(lines)
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                login = (row.get("login") or "").strip()
                password = (row.get("password") or "").strip()
                if not login or not password:
                    skipped += 1
                    continue
                fields = {"password": password}
                _NA = {"n/a", "na", "none", "null", ""}
                for csv_col, db_col in [
                    ("steam_id", "steam_id"), ("ban", "ban_status"),
                    ("prime", "prime"), ("trophy", "trophy"),
                    ("behavior", "behavior"), ("license", "license"),
                ]:
                    val = (row.get(csv_col) or "").strip()
                    if val:
                        if db_col in ("prime", "trophy", "behavior") and val.lower() in _NA:
                            val = "\u2014"
                        fields[db_col] = val
                try:
                    await upsert(login, fields)
                    imported += 1
                except Exception as exc:
                    logger.error(f"Logpass CSV import error for '{login}': {exc}")
                    errors.append(f"{login}: {exc}")
        else:
            for raw in lines:
                line = raw.strip()
                if not line:
                    skipped += 1
                    continue
                # Skip JSON/mafile lines
                if line.startswith("{") or line.startswith("["):
                    skipped += 1
                    continue
                if "|" in line:
                    parts = line.split("|", 1)
                elif ":" in line:
                    parts = line.split(":", 1)
                else:
                    skipped += 1
                    continue
                login, password = parts[0].strip(), parts[1].strip()
                if not login or not password:
                    skipped += 1
                    continue
                # Reject if password looks like JSON (mafile embedded) or is too long
                if password.startswith("{") or password.startswith("[") or len(password) > 128:
                    skipped += 1
                    logger.warning(f"Logpass import: skipped '{login}' — password looks like mafile or is too long ({len(password)} chars)")
                    continue
                try:
                    await upsert(login, {"password": password})
                    imported += 1
                except Exception as exc:
                    logger.error(f"Logpass import error for '{login}': {exc}")
                    errors.append(f"{login}: {exc}")

        await db.commit()
    except Exception as exc:
        logger.exception(f"Logpass import failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

    return {"imported": imported, "skipped": skipped, "errors": errors}


@router.post("/validate")
async def validate_logpass(data: dict):
    """Submit validation task for selected log:pass accounts."""
    ids: list[int] = data.get("account_ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="No account IDs provided")

    db = await get_db()
    placeholders = ",".join("?" for _ in ids)
    cursor = await db.execute(
        f"SELECT * FROM logpass_accounts WHERE id IN ({placeholders})", ids
    )
    accounts = [dict(r) for r in await cursor.fetchall()]
    if not accounts:
        raise HTTPException(status_code=404, detail="No accounts found")

    task_id = await task_manager.submit(
        task_type="logpass_validate",
        accounts=accounts,
        params={},
    )
    logger.info(f"logpass_validate submitted for {len(accounts)} accounts → task {task_id}")
    return {"task_id": task_id, "accounts_count": len(accounts)}


@router.post("/full-parse")
async def full_parse_logpass(data: dict):
    """Submit full parse task (prime, trophy, behavior, licenses) for selected accounts."""
    ids: list[int] = data.get("account_ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="No account IDs provided")

    db = await get_db()
    placeholders = ",".join("?" for _ in ids)
    cursor = await db.execute(
        f"SELECT * FROM logpass_accounts WHERE id IN ({placeholders})", ids
    )
    accounts = [dict(r) for r in await cursor.fetchall()]
    if not accounts:
        raise HTTPException(status_code=404, detail="No accounts found")

    task_id = await task_manager.submit(
        task_type="logpass_full_parse",
        accounts=accounts,
        params={},
    )
    logger.info(f"logpass_full_parse submitted for {len(accounts)} accounts → task {task_id}")
    return {"task_id": task_id, "accounts_count": len(accounts)}


@router.post("/assign-proxies")
async def logpass_assign_proxies():
    """Round-robin assign proxies to logpass accounts that don't have one."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT address FROM proxies ORDER BY id")
    proxies = [r["address"] for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute(
        "SELECT id FROM logpass_accounts WHERE proxy IS NULL OR proxy = '' ORDER BY id"
    )
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        await db.execute(
            "UPDATE logpass_accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxies[i % len(proxies)], acc_id),
        )
    await db.commit()
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/reassign-proxies")
async def logpass_reassign_proxies():
    """Round-robin reassign proxies to ALL logpass accounts."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT address FROM proxies ORDER BY id")
    proxies = [r["address"] for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute("SELECT id FROM logpass_accounts ORDER BY id")
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        await db.execute(
            "UPDATE logpass_accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxies[i % len(proxies)], acc_id),
        )
    await db.commit()
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/clear-proxies")
async def logpass_clear_proxies():
    """Remove proxy from all logpass accounts."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE logpass_accounts SET proxy = NULL, updated_at = datetime('now') WHERE proxy IS NOT NULL AND proxy != ''"
    )
    await db.commit()
    return {"cleared": cursor.rowcount}


@router.post("/{account_id}/browser")
async def open_logpass_browser(account_id: int):
    """Open Chrome browser with saved session cookies for a logpass account."""
    import asyncio
    db = await get_db()
    cursor = await db.execute("SELECT * FROM logpass_accounts WHERE id = ?", (account_id,))
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
                task_type="logpass_validate",
                accounts=[account],
                params={},
            )
            logger.info(f"Cookies dead for {account['login']}, auto-revalidating → task {task_id}")
            return {"status": "revalidating", "message": "Cookies expired. Re-validating...", "task_id": task_id}
        raise HTTPException(status_code=400, detail="Session cookies expired. Re-validate the account.")

    from app.services.browser_login import open_browser_with_cookies

    async def _run():
        try:
            await open_browser_with_cookies(account)
        except Exception as exc:
            logger.error(f"Browser open failed for {account['login']}: {exc}")

    asyncio.create_task(_run())
    return {"status": "ok", "message": "Browser opening..."}
