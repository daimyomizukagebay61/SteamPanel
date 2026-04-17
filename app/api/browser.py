import asyncio

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.database import get_db
from app.config import read_validation_settings
from app.core.task_manager import task_manager

router = APIRouter(prefix="/api", tags=["browser"])


@router.post("/accounts/{account_id}/browser")
async def open_browser(account_id: int):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(404, "Account not found")

    account = dict(row)

    from app.services.steam_auth import check_cookies_alive, _resolve_proxy
    from app.config import read_validation_settings

    # If account isn't validated or has no cookies — auto-revalidate if enabled
    if account["status"] != "valid" or not account.get("session_cookies"):
        val_settings = read_validation_settings()
        if val_settings.get("auto_revalidate_browser"):
            task_id = await task_manager.submit(
                task_type="validate",
                accounts=[account],
                params={},
            )
            logger.info(f"Account {account['login']} not valid/no cookies, auto-revalidating → task {task_id}")
            return {"status": "revalidating", "message": "Cookies expired. Re-validating...", "task_id": task_id}
        if account["status"] != "valid":
            raise HTTPException(400, "Account is not validated")
        raise HTTPException(400, "No session cookies. Validate the account first.")

    proxy = await _resolve_proxy(account)
    alive = await check_cookies_alive(account["session_cookies"], proxy)
    if not alive:
        val_settings = read_validation_settings()
        if val_settings.get("auto_revalidate_browser"):
            task_id = await task_manager.submit(
                task_type="validate",
                accounts=[account],
                params={},
            )
            logger.info(f"Cookies dead for {account['login']}, auto-revalidating → task {task_id}")
            return {"status": "revalidating", "message": "Cookies expired. Re-validating...", "task_id": task_id}
        raise HTTPException(400, "Session cookies expired. Re-validate the account.")

    from app.services.browser_login import open_browser_with_cookies

    async def _run():
        try:
            await open_browser_with_cookies(account)
        except Exception as exc:
            logger.error(f"Browser open failed for {account['login']}: {exc}")

    asyncio.create_task(_run())

    return {"status": "ok", "message": "Browser opening..."}
