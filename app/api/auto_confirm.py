from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.core.auto_confirm import auto_confirm_manager

router = APIRouter(prefix="/api/auto-confirm", tags=["auto-confirm"])


class AutoConfirmRequest(BaseModel):
    account_ids: list[int]


@router.post("/start")
async def start_auto_confirm(body: AutoConfirmRequest):
    db = await get_db()
    started: list[int] = []
    for aid in body.account_ids:
        cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (aid,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, f"Account {aid} not found")
        account = dict(row)
        if not account.get("identity_secret"):
            raise HTTPException(400, f"Account {account['login']} has no identity_secret (mafile required)")
        await auto_confirm_manager.start(account)
        await db.execute("UPDATE accounts SET auto_confirm = 1 WHERE id = ?", (aid,))
        started.append(aid)
    await db.commit()
    return {"started": started}


@router.post("/stop")
async def stop_auto_confirm(body: AutoConfirmRequest):
    db = await get_db()
    stopped: list[int] = []
    for aid in body.account_ids:
        auto_confirm_manager.stop(aid)
        await db.execute("UPDATE accounts SET auto_confirm = 0 WHERE id = ?", (aid,))
        stopped.append(aid)
    await db.commit()
    return {"stopped": stopped}


@router.get("/status")
async def auto_confirm_status():
    running = auto_confirm_manager.running_ids()
    errors = auto_confirm_manager.pop_errors()
    return {"running": list(running), "errors": errors}
