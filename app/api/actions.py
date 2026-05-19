from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from loguru import logger

from app.database import get_db
from app.models import ActionRequest
from app.core.task_manager import task_manager

router = APIRouter(prefix="/api/actions", tags=["actions"])

VALID_ACTIONS = {
    "change_password",
    "random_password",
    "change_email",
    "change_phone",
    "remove_guard",
    "generate_2fa",
    "validate",
    "add_friend",
    "accept_logins",
    "change_language",
}


@router.post("")
async def execute_action(request: ActionRequest):
    if request.action not in VALID_ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action. Valid: {', '.join(sorted(VALID_ACTIONS))}",
        )

    db = await get_db()
    placeholders = ",".join("?" for _ in request.account_ids)
    cursor = await db.execute(
        f"SELECT * FROM accounts WHERE id IN ({placeholders})",
        request.account_ids,
    )
    accounts = [dict(r) for r in await cursor.fetchall()]

    if not accounts:
        raise HTTPException(status_code=404, detail="No accounts found")

    task_id = await task_manager.submit(
        task_type=request.action,
        accounts=accounts,
        params=request.params or {},
    )

    logger.info(
        f"Action '{request.action}' submitted for {len(accounts)} accounts → task {task_id}"
    )
    return {"task_id": task_id, "accounts_count": len(accounts)}


class Generate2FARequest(BaseModel):
    shared_secret: str


class Generate2FAByAccountRequest(BaseModel):
    account_id: int


@router.post("/generate-2fa")
async def generate_2fa_code(request: Generate2FARequest):
    """Server-side 2FA code generation from shared_secret."""
    from app.services.steam_guard import generate_2fa_code as gen_code

    try:
        code = gen_code(request.shared_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid shared_secret: {exc}") from exc
    return {"code": code}


@router.post("/generate-2fa-by-account")
async def generate_2fa_by_account(request: Generate2FAByAccountRequest):
    """Generate 2FA code for an account using its stored shared_secret."""
    from app.services.steam_guard import generate_2fa_code as gen_code

    db = await get_db()
    cursor = await db.execute(
        "SELECT shared_secret FROM accounts WHERE id = ?",
        (request.account_id,),
    )
    row = await cursor.fetchone()
    if not row or not row["shared_secret"]:
        raise HTTPException(status_code=404, detail="Account not found or has no shared_secret")
    return {"code": gen_code(row["shared_secret"])}


class ConfirmationRespondRequest(BaseModel):
    ids: list[str]
    nonces: list[str]
    accept: bool


@router.get("/confirmations/{account_id}")
async def get_confirmations(account_id: int):
    """Fetch pending Steam confirmations for an account."""
    from app.services.steam_confirmations import fetch_confirmations

    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    account = await cursor.fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        confirmations = await fetch_confirmations(dict(account))
        return {"success": True, "confirmations": confirmations}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[confirmations] Error fetching for account {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/confirmations/{account_id}/respond")
async def respond_confirmations(account_id: int, request: ConfirmationRespondRequest):
    """Accept or deny confirmations for an account."""
    from app.services.steam_confirmations import respond_to_confirmation

    if len(request.ids) != len(request.nonces):
        raise HTTPException(status_code=400, detail="ids and nonces must have same length")

    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    account = await cursor.fetchone()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    try:
        success = await respond_to_confirmation(dict(account), request.ids, request.nonces, request.accept)
        return {"success": success}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[confirmations] Error responding for account {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
