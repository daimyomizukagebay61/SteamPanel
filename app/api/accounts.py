import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from loguru import logger

from app.database import get_db
from app.models import (
    AccountCreate,
    AccountOut,
    AccountUpdate,
    BulkImportResult,
    MafileData,
)
from app.config import settings

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
async def list_accounts():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts ORDER BY id DESC")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/{account_id}", response_model=AccountOut)
async def get_account(account_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.post("", response_model=AccountOut, status_code=201)
async def create_account(account: AccountCreate):
    db = await get_db()
    cursor = await db.execute(
        """INSERT INTO accounts (login, password, steam_id, email, email_password, phone, proxy, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            account.login,
            account.password,
            account.steam_id,
            account.email,
            account.email_password,
            account.phone,
            account.proxy,
            account.notes,
        ),
    )
    await db.commit()
    new_cursor = await db.execute(
        "SELECT * FROM accounts WHERE id = ?", (cursor.lastrowid,)
    )
    return dict(await new_cursor.fetchone())


@router.put("/{account_id}", response_model=AccountOut)
async def update_account(account_id: int, account: AccountUpdate):
    db = await get_db()
    fields = {k: v for k, v in account.model_dump().items() if v is not None}
    # Allow clearing fields by sending empty string → store as NULL
    for k, v in account.model_dump().items():
        if v == "" and k not in fields:
            fields[k] = None
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
        f"UPDATE accounts SET {set_clause} WHERE id = ?",
        values,
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    return dict(row)


@router.delete("/{account_id}", status_code=204)
async def delete_account(account_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT mafile_path FROM accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    if row["mafile_path"]:
        mafile = Path(row["mafile_path"])
        if mafile.exists():
            mafile.unlink()
    await db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    await db.commit()

@router.post("/delete-bulk", status_code=200)
async def delete_accounts_bulk(request: dict):
    """Delete multiple accounts by IDs list, or all if ids is empty."""
    db = await get_db()
    ids = request.get("ids", [])

    if ids:
        placeholders = ",".join("?" for _ in ids)
        cursor = await db.execute(
            f"SELECT id, mafile_path FROM accounts WHERE id IN ({placeholders})", ids
        )
    else:
        cursor = await db.execute("SELECT id, mafile_path FROM accounts")

    rows = await cursor.fetchall()
    count = 0
    for row in rows:
        if row["mafile_path"]:
            mafile = Path(row["mafile_path"])
            if mafile.exists():
                mafile.unlink()
        count += 1

    if ids:
        placeholders = ",".join("?" for _ in ids)
        await db.execute(f"DELETE FROM accounts WHERE id IN ({placeholders})", ids)
    else:
        await db.execute("DELETE FROM accounts")

    await db.commit()
    return {"deleted": count}


@router.post("/assign-proxies")
async def assign_proxies_round_robin():
    """Round-robin assign proxies to accounts that don't have one."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT id, address, protocol FROM proxies ORDER BY id")
    proxies = [dict(r) for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute("SELECT id FROM accounts WHERE proxy IS NULL OR proxy = '' ORDER BY id")
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        proxy = proxies[i % len(proxies)]
        await db.execute(
            "UPDATE accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxy["address"], acc_id),
        )
    await db.commit()

    from app.core.proxy_manager import proxy_manager
    await proxy_manager.load()
    logger.info(f"Assigned {len(proxies)} proxies to {len(account_ids)} accounts (round-robin)")
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/reassign-proxies")
async def reassign_proxies_round_robin():
    """Round-robin reassign proxies to ALL accounts, overwriting existing."""
    db = await get_db()
    proxy_cursor = await db.execute("SELECT id, address, protocol FROM proxies ORDER BY id")
    proxies = [dict(r) for r in await proxy_cursor.fetchall()]
    if not proxies:
        raise HTTPException(status_code=400, detail="No proxies available")

    acc_cursor = await db.execute("SELECT id FROM accounts ORDER BY id")
    account_ids = [r["id"] for r in await acc_cursor.fetchall()]
    if not account_ids:
        return {"assigned": 0, "proxies_used": 0}

    for i, acc_id in enumerate(account_ids):
        proxy = proxies[i % len(proxies)]
        await db.execute(
            "UPDATE accounts SET proxy = ?, updated_at = datetime('now') WHERE id = ?",
            (proxy["address"], acc_id),
        )
    await db.commit()

    from app.core.proxy_manager import proxy_manager
    await proxy_manager.load()
    logger.info(f"Reassigned {len(proxies)} proxies to {len(account_ids)} accounts (round-robin)")
    return {"assigned": len(account_ids), "proxies_used": len(proxies)}


@router.post("/clear-proxies")
async def clear_all_proxies():
    """Remove proxy assignment from all accounts."""
    db = await get_db()
    cursor = await db.execute("UPDATE accounts SET proxy = NULL, updated_at = datetime('now') WHERE proxy IS NOT NULL AND proxy != ''")
    await db.commit()
    count = cursor.rowcount

    from app.core.proxy_manager import proxy_manager
    await proxy_manager.load()
    logger.info(f"Cleared proxies from {count} accounts")
    return {"cleared": count}


@router.post("/import", response_model=BulkImportResult)
async def import_accounts(file: UploadFile = File(...)):
    """Import accounts.

    Supported formats (: or | separator):
      login|password|{mafile_json}
      login|password|email|email_password|{mafile_json}
      login|password|email|email_password
    """
    content = (await file.read()).decode("utf-8", errors="ignore")
    result = BulkImportResult()
    db = await get_db()

    for raw_line in content.strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Split off embedded mafile JSON (everything from first '{' onward)
        json_start = line.find("{")
        if json_start != -1:
            mafile_str = line[json_start:]
            prefix = line[:json_start].rstrip("|:")
        else:
            mafile_str = None
            prefix = line

        sep = "|" if "|" in prefix else ":"
        parts = prefix.split(sep)

        if mafile_str:
            # Accepted: 2 fields (login|pass) or 4 fields (login|pass|email|email_pass)
            if len(parts) == 2:
                login, password = parts
                email = email_password = None
            elif len(parts) == 4:
                login, password, email, email_password = parts
            else:
                result.errors.append(f"Invalid prefix (need 2 or 4 fields): {line[:50]}")
                result.skipped += 1
                continue

            try:
                mafile_data = json.loads(mafile_str)
            except json.JSONDecodeError as exc:
                result.errors.append(f"Bad mafile JSON on line starting '{prefix[:30]}': {exc}")
                result.skipped += 1
                continue

            # Fall back to mail fields embedded in the mafile JSON itself
            if not email:
                email = mafile_data.get("mail") or mafile_data.get("email") or None
                email_password = mafile_data.get("mail_password") or mafile_data.get("email_password") or None
        else:
            # No mafile — must be exactly 4 fields
            if len(parts) != 4:
                result.errors.append(f"Invalid line (need 4 fields): {line[:50]}")
                result.skipped += 1
                continue
            login, password, email, email_password = parts
            mafile_data = None

        try:
            # Check if account with this login already exists
            existing = await db.execute(
                "SELECT id FROM accounts WHERE login = ?", (login,)
            )
            if await existing.fetchone():
                result.errors.append(f"{login}: уже существует")
                result.skipped += 1
                continue

            await db.execute(
                """INSERT INTO accounts (login, password, email, email_password)
                   VALUES (?, ?, ?, ?)""",
                (login, password, email or None, email_password or None),
            )
            result.imported += 1
        except Exception as exc:
            result.errors.append(f"{login}: {exc}")
            result.skipped += 1
            continue

        if mafile_data:
            account_name = mafile_data.get("account_name") or login
            shared_secret = mafile_data.get("shared_secret") or ""
            identity_secret = mafile_data.get("identity_secret") or ""
            steam_id = (mafile_data.get("Session") or {}).get("SteamID") or None

            settings.mafiles_dir.mkdir(parents=True, exist_ok=True)
            dest = settings.mafiles_dir / f"{account_name}.mafile"
            dest.write_text(json.dumps(mafile_data, ensure_ascii=False), encoding="utf-8")

            await db.execute(
                """UPDATE accounts
                   SET mafile_path = ?, shared_secret = ?, identity_secret = ?, steam_id = ?
                   WHERE login = ? AND steam_id IS NULL""",
                (str(dest), shared_secret, identity_secret, steam_id, login),
            )

    await db.commit()
    logger.info(f"Imported {result.imported} accounts, skipped {result.skipped}")
    return result


@router.post("/{account_id}/mafile")
async def upload_mafile(account_id: int, file: UploadFile = File(...)):
    """Bind a .mafile to an account."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")

    content = (await file.read()).decode("utf-8")
    try:
        mafile = MafileData.model_validate_json(content)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid mafile format")

    settings.mafiles_dir.mkdir(parents=True, exist_ok=True)
    steam_id = mafile.Session.SteamID or row["steam_id"] or account_id
    mafile_path = settings.mafiles_dir / f"{steam_id}.mafile"
    mafile_path.write_text(content, encoding="utf-8")

    await db.execute(
        """UPDATE accounts SET mafile_path = ?, shared_secret = ?, identity_secret = ?,
           steam_id = COALESCE(steam_id, ?), updated_at = datetime('now') WHERE id = ?""",
        (
            str(mafile_path),
            mafile.shared_secret,
            mafile.identity_secret,
            str(mafile.Session.SteamID) if mafile.Session.SteamID else None,
            account_id,
        ),
    )
    await db.commit()
    return {"status": "ok", "mafile_path": str(mafile_path)}
