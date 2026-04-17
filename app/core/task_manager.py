import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Protocol

from loguru import logger

from app.config import settings

DEFAULT_MAX_PARALLEL = 10
DEFAULT_ACCOUNT_TIMEOUT = 90  # fallback for actions not in the map below

# Per-action timeouts (seconds). Fast read-only actions get 60s;
# write actions that involve SMS/email prompts get 120s.
TASK_TIMEOUTS: dict[str, int] = {
    "validate": 60,
    "remove_guard": 60,
    "change_password": 60,
    "random_password": 60,
    "change_phone": 120,
    "change_email": 120,
}


def _read_max_threads() -> int:
    from app.config import read_validation_settings
    return int(read_validation_settings().get("max_threads", DEFAULT_MAX_PARALLEL))


def _read_account_timeout() -> int:
    from app.config import read_validation_settings
    return int(read_validation_settings().get("account_timeout", DEFAULT_ACCOUNT_TIMEOUT))


class TaskHandler(Protocol):
    async def __call__(self, account: dict, params: dict, *, task_id: str) -> None: ...


class TaskManager:
    def __init__(self) -> None:
        self._running: dict[str, asyncio.Task] = {}
        self._handlers: dict[str, TaskHandler] = {}
        self._prompts: dict[str, dict[str, Any]] = {}
        self._steps: dict[str, dict[str, Any]] = {}
        self._active_counts: dict[str, int] = {}
        self._account_results: dict[str, dict[int, dict[str, str]]] = {}
        self._account_steps: dict[str, dict[int, dict[str, int]]] = {}

    def register_handler(self, action: str, handler: TaskHandler) -> None:
        self._handlers[action] = handler

    async def submit(
        self,
        task_type: str,
        accounts: list[dict],
        params: dict,
    ) -> str:
        task_id = uuid.uuid4().hex[:12]
        account_ids = [acc.get("id", 0) for acc in accounts]

        from app.database import get_db

        db = await get_db()
        await db.execute(
            "INSERT INTO tasks (id, type, status, total, account_ids) VALUES (?, ?, 'running', ?, ?)",
            (task_id, task_type, len(accounts), json.dumps(account_ids)),
        )
        await db.commit()

        async_task = asyncio.create_task(
            self._execute(task_id, task_type, accounts, params)
        )
        self._running[task_id] = async_task
        return task_id

    async def _execute(
        self,
        task_id: str,
        task_type: str,
        accounts: list[dict],
        params: dict,
    ) -> None:
        from app.database import get_db

        handler = self._handlers.get(task_type)
        if not handler:
            db = await get_db()
            await db.execute(
                "UPDATE tasks SET status = 'failed', error = ? WHERE id = ?",
                (f"No handler for action: {task_type}", task_id),
            )
            await db.commit()
            return

        completed = 0
        errors: list[str] = []
        lock = asyncio.Lock()
        max_parallel = _read_max_threads()
        account_timeout = TASK_TIMEOUTS.get(task_type, _read_account_timeout())
        sem = asyncio.Semaphore(max_parallel)
        self._active_counts[task_id] = 0
        self._account_results[task_id] = {}
        total = len(accounts)

        async def process_one(account: dict, idx: int) -> None:
            nonlocal completed
            login = account.get("login", "?")
            acc_id = account.get("id", 0)
            logger.debug(f"[{task_type}] ({idx}/{total}) processing {login}...")

            async with sem:
                async with lock:
                    self._active_counts[task_id] = self._active_counts.get(task_id, 0) + 1
                try:
                    await asyncio.wait_for(
                        handler(account, params, task_id=task_id),
                        timeout=account_timeout,
                    )
                    logger.success(f"[{task_type}] ({idx}/{total}) {login} — done")
                    async with lock:
                        self._account_results[task_id][acc_id] = {"status": "ok"}
                except asyncio.TimeoutError:
                    async with lock:
                        errors.append(f"{login}: timed out after {account_timeout}s")
                        self._account_results[task_id][acc_id] = {"status": "error", "error": f"Timed out after {account_timeout}s"}
                    logger.error(f"[{task_type}] ({idx}/{total}) {login} — timed out after {account_timeout}s")
                except Exception as exc:
                    err_str = str(exc)
                    async with lock:
                        errors.append(f"{login}: {exc}")
                        self._account_results[task_id][acc_id] = {"status": "error", "error": err_str}
                    logger.error(f"[{task_type}] ({idx}/{total}) {login} — error: {exc}")
                finally:
                    async with lock:
                        self._active_counts[task_id] = max(0, self._active_counts.get(task_id, 0) - 1)

            async with lock:
                completed += 1
                db = await get_db()
                await db.execute(
                    "UPDATE tasks SET progress = ?, updated_at = datetime('now') WHERE id = ?",
                    (completed, task_id),
                )
                await db.commit()

        try:
            tasks = [process_one(acc, i) for i, acc in enumerate(accounts, 1)]
            await asyncio.gather(*tasks)

            db = await get_db()
            status = "completed"
            result = f"Done: {completed - len(errors)} success, {len(errors)} errors"
            error_text = "; ".join(errors[:10]) if errors else None
            results_json = json.dumps(
                {str(k): v for k, v in self._account_results.get(task_id, {}).items()}
            )
            await db.execute(
                "UPDATE tasks SET status = ?, result = ?, error = ?, account_results = ?, updated_at = datetime('now') WHERE id = ?",
                (status, result, error_text, results_json, task_id),
            )
            await db.commit()

        except asyncio.CancelledError:
            db = await get_db()
            results_json = json.dumps(
                {str(k): v for k, v in self._account_results.get(task_id, {}).items()}
            )
            await db.execute(
                "UPDATE tasks SET status = 'cancelled', account_results = ?, updated_at = datetime('now') WHERE id = ?",
                (results_json, task_id),
            )
            await db.commit()
        except Exception as exc:
            logger.error(f"Task {task_id} fatal error: {exc}")
            db = await get_db()
            results_json = json.dumps(
                {str(k): v for k, v in self._account_results.get(task_id, {}).items()}
            )
            await db.execute(
                "UPDATE tasks SET status = 'failed', error = ?, account_results = ?, updated_at = datetime('now') WHERE id = ?",
                (str(exc)[:500], results_json, task_id),
            )
            await db.commit()
        finally:
            self._running.pop(task_id, None)
            self._steps.pop(task_id, None)
            self._active_counts.pop(task_id, None)
            self._account_results.pop(task_id, None)
            self._account_steps.pop(task_id, None)

    def get_active_count(self, task_id: str) -> int:
        return self._active_counts.get(task_id, 0)

    def get_account_results(self, task_id: str) -> dict[int, dict[str, str]]:
        return self._account_results.get(task_id, {})

    def clear_account_results(self, task_id: str) -> None:
        self._account_results.pop(task_id, None)

    async def set_step(self, task_id: str, step: int, total_steps: int, label: str = "", acc_id: int = 0) -> None:
        self._steps[task_id] = {"step": step, "total_steps": total_steps, "label": label}
        if acc_id:
            self._account_steps.setdefault(task_id, {})[acc_id] = {"step": step, "total": total_steps}

    def get_step_info(self, task_id: str) -> dict[str, Any] | None:
        return self._steps.get(task_id)

    def get_account_steps(self, task_id: str) -> dict[int, dict[str, int]]:
        return self._account_steps.get(task_id, {})

    async def prompt_user(self, task_id: str, message: str, login: str = "") -> str:
        """Pause task execution and ask the user for input via SSE prompt."""
        key = f"{task_id}:{login}" if login else task_id
        event = asyncio.Event()
        self._prompts[key] = {"message": message, "login": login, "event": event, "response": ""}
        await event.wait()
        response = self._prompts.pop(key, {}).get("response", "")
        return response

    def respond(self, task_id: str, value: str, login: str = "") -> bool:
        key = f"{task_id}:{login}" if login else task_id
        prompt = self._prompts.get(key)
        if not prompt:
            return False
        prompt["response"] = value
        prompt["event"].set()
        return True

    def get_pending_prompt(self, task_id: str) -> dict[str, str] | None:
        """Return first pending prompt for this task (with login info)."""
        prefix = f"{task_id}:"
        for key, prompt in self._prompts.items():
            if key == task_id or key.startswith(prefix):
                return {"message": prompt["message"], "login": prompt.get("login", "")}
        return None

    def cancel(self, task_id: str) -> bool:
        task = self._running.get(task_id)
        if task and not task.done():
            task.cancel()
            return True
        return False

    def active_count(self) -> int:
        return len(self._running)


task_manager = TaskManager()
