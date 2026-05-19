"""AutoAcceptManager — manages per-account background loops for auto-accepting Steam logins."""

import asyncio

import aiohttp
from loguru import logger

from app.services.steam_auto_accept import mobile_login, get_pending_sessions, confirm_session
from app.database import get_db
from app.config import read_services_settings

_DEFAULT_INTERVAL = 15


class AutoAcceptManager:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task] = {}
        self._tokens: dict[int, str] = {}
        self._errors: dict[int, str] = {}

    async def start(self, account: dict) -> None:
        account_id = account["id"]
        if account_id in self._tasks and not self._tasks[account_id].done():
            return

        self._tasks[account_id] = asyncio.create_task(self._loop(account))
        logger.info(f"[auto-accept] Started monitoring for {account['login']} (id={account_id})")

    def stop(self, account_id: int) -> None:
        task = self._tasks.pop(account_id, None)
        self._tokens.pop(account_id, None)
        self._errors.pop(account_id, None)
        if task and not task.done():
            task.cancel()
            logger.info(f"[auto-accept] Stopped monitoring for id={account_id}")

    def is_running(self, account_id: int) -> bool:
        task = self._tasks.get(account_id)
        return task is not None and not task.done()

    def running_ids(self) -> set[int]:
        # Cleanup dead tasks
        dead = [aid for aid, t in self._tasks.items() if t.done()]
        for aid in dead:
            self._tasks.pop(aid, None)
            self._tokens.pop(aid, None)
        return {aid for aid, t in self._tasks.items() if not t.done()}

    def get_errors(self) -> dict[int, str]:
        """Return error messages for accounts that stopped unexpectedly."""
        return dict(self._errors)

    def pop_errors(self) -> dict[int, str]:
        """Return and clear error messages."""
        errors = dict(self._errors)
        self._errors.clear()
        return errors

    async def _loop(self, account: dict) -> None:
        account_id = account["id"]
        login = account["login"]

        async with aiohttp.ClientSession() as session:
            # Initial mobile login
            token = await mobile_login(session, account)
            if not token:
                logger.error(f"[auto-accept] Initial login failed for {login}, stopping")
                self._errors[account_id] = "Initial login failed"
                await self._disable_in_db(account_id)
                return
            self._tokens[account_id] = token

            while True:
                try:
                    interval = read_services_settings().get("auto_accept_interval", _DEFAULT_INTERVAL)
                    await asyncio.sleep(interval)

                    client_ids = await get_pending_sessions(session, self._tokens[account_id])

                    # Token expired — re-login
                    if client_ids is None:
                        logger.warning(f"[auto-accept] Token expired for {login}, re-logging...")
                        new_token = await mobile_login(session, account)
                        if new_token:
                            self._tokens[account_id] = new_token
                            client_ids = await get_pending_sessions(session, new_token)
                        else:
                            logger.error(f"[auto-accept] Re-login failed for {login}, stopping")
                            self._errors[account_id] = "Re-login failed (token expired)"
                            await self._disable_in_db(account_id)
                            return

                    if not client_ids:
                        continue

                    for cid in client_ids:
                        await confirm_session(session, self._tokens[account_id], account, cid)
                        await asyncio.sleep(1)

                except asyncio.CancelledError:
                    logger.info(f"[auto-accept] Loop cancelled for {login}")
                    return
                except Exception as exc:
                    logger.error(f"[auto-accept] Loop error for {login}: {exc}")
                    await asyncio.sleep(interval)

    async def stop_all(self) -> None:
        for aid in list(self._tasks):
            self.stop(aid)

    async def _disable_in_db(self, account_id: int) -> None:
        """Reset auto_accept flag in DB when task fails."""
        try:
            db = await get_db()
            await db.execute("UPDATE accounts SET auto_accept = 0 WHERE id = ?", (account_id,))
            await db.commit()
            logger.info(f"[auto-accept] Disabled auto_accept in DB for id={account_id}")
        except Exception as exc:
            logger.error(f"[auto-accept] Failed to update DB for id={account_id}: {exc}")


auto_accept_manager = AutoAcceptManager()
