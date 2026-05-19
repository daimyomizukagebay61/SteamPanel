"""AutoConfirmManager — per-account background loops for auto-confirming Steam mobile confirmations."""

import asyncio
import random

from loguru import logger

from app.services.steam_confirmations import fetch_confirmations, respond_to_confirmation
from app.database import get_db
from app.config import read_services_settings

_DEFAULT_INTERVAL = 30
_MAX_CONSECUTIVE_ERRORS = 3


class AutoConfirmManager:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task] = {}
        self._errors: dict[int, str] = {}

    async def start(self, account: dict) -> None:
        account_id = account["id"]
        if account_id in self._tasks and not self._tasks[account_id].done():
            return

        self._tasks[account_id] = asyncio.create_task(self._loop(account))
        logger.info(f"[auto-confirm] Started for {account['login']} (id={account_id})")

    def stop(self, account_id: int) -> None:
        task = self._tasks.pop(account_id, None)
        self._errors.pop(account_id, None)
        if task and not task.done():
            task.cancel()
            logger.info(f"[auto-confirm] Stopped for id={account_id}")

    def is_running(self, account_id: int) -> bool:
        task = self._tasks.get(account_id)
        return task is not None and not task.done()

    def running_ids(self) -> set[int]:
        dead = [aid for aid, t in self._tasks.items() if t.done()]
        for aid in dead:
            self._tasks.pop(aid, None)
        return {aid for aid, t in self._tasks.items() if not t.done()}

    def get_errors(self) -> dict[int, str]:
        return dict(self._errors)

    def pop_errors(self) -> dict[int, str]:
        errors = dict(self._errors)
        self._errors.clear()
        return errors

    async def stop_all(self) -> None:
        for aid in list(self._tasks):
            self.stop(aid)

    async def _loop(self, account: dict) -> None:
        account_id = account["id"]
        login = account["login"]
        consecutive_errors = 0

        # Jitter: spread wakeups across the interval to avoid burst load
        jitter = random.uniform(0, _DEFAULT_INTERVAL)
        await asyncio.sleep(jitter)

        while True:
            try:
                interval = read_services_settings().get("auto_confirm_interval", _DEFAULT_INTERVAL)
                await asyncio.sleep(interval)

                confirmations = await fetch_confirmations(account)
                consecutive_errors = 0

                if not confirmations:
                    continue

                ids = [c["id"] for c in confirmations]
                nonces = [c["nonce"] for c in confirmations]
                success = await respond_to_confirmation(account, ids, nonces, accept=True)
                if success:
                    logger.success(f"[auto-confirm] {login}: accepted {len(ids)} confirmation(s)")
                else:
                    logger.warning(f"[auto-confirm] {login}: respond returned success=False")

            except asyncio.CancelledError:
                logger.info(f"[auto-confirm] Loop cancelled for {login}")
                return
            except Exception as exc:
                consecutive_errors += 1
                logger.error(f"[auto-confirm] Loop error for {login} ({consecutive_errors}/{_MAX_CONSECUTIVE_ERRORS}): {exc}")
                if consecutive_errors >= _MAX_CONSECUTIVE_ERRORS:
                    logger.error(f"[auto-confirm] Too many errors for {login}, disabling")
                    self._errors[account_id] = str(exc)
                    await self._disable_in_db(account_id)
                    return
                await asyncio.sleep(interval if "interval" in dir() else _DEFAULT_INTERVAL)

    async def _disable_in_db(self, account_id: int) -> None:
        try:
            db = await get_db()
            await db.execute("UPDATE accounts SET auto_confirm = 0 WHERE id = ?", (account_id,))
            await db.commit()
            logger.info(f"[auto-confirm] Disabled auto_confirm in DB for id={account_id}")
        except Exception as exc:
            logger.error(f"[auto-confirm] Failed to update DB for id={account_id}: {exc}")


auto_confirm_manager = AutoConfirmManager()
