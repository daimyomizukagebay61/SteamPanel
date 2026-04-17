from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import get_db
from app.core.auto_accept import auto_accept_manager

router = APIRouter(prefix="/api/auto-accept", tags=["auto-accept"])


class AutoAcceptRequest(BaseModel):
    account_ids: list[int]


@router.post("/start")
async def start_auto_accept(body: AutoAcceptRequest):
    db = await get_db()
    started: list[int] = []
    for aid in body.account_ids:
        cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (aid,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(404, f"Account {aid} not found")
        account = dict(row)
        if not account.get("shared_secret"):
            raise HTTPException(400, f"Account {account['login']} has no shared_secret (mafile)")
        await auto_accept_manager.start(account)
        await db.execute("UPDATE accounts SET auto_accept = 1 WHERE id = ?", (aid,))
        started.append(aid)
    await db.commit()
    return {"started": started}


@router.post("/stop")
async def stop_auto_accept(body: AutoAcceptRequest):
    db = await get_db()
    stopped: list[int] = []
    for aid in body.account_ids:
        auto_accept_manager.stop(aid)
        await db.execute("UPDATE accounts SET auto_accept = 0 WHERE id = ?", (aid,))
        stopped.append(aid)
    await db.commit()
    return {"stopped": stopped}


@router.get("/status")
async def auto_accept_status():
    running = auto_accept_manager.running_ids()
    errors = auto_accept_manager.pop_errors()
    return {"running": list(running), "errors": errors}
