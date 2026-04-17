import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from app.database import get_db
from app.models import TaskOut
from app.core.task_manager import task_manager

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskOut])
async def list_tasks():
    db = await get_db()
    cursor = await db.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: str):
    db = await get_db()
    cursor = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return dict(row)


@router.get("/{task_id}/stream")
async def stream_task(task_id: str):
    """SSE endpoint for real-time task progress."""

    async def event_generator():
        last_data = None
        while True:
            db = await get_db()
            cursor = await db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            row = await cursor.fetchone()
            if not row:
                yield f"data: {json.dumps({'error': 'Task not found'})}\n\n"
                break

            task = dict(row)
            # Parse JSON string fields from DB into dicts for proper serialization
            for json_field in ("account_ids", "account_results"):
                if isinstance(task.get(json_field), str):
                    try:
                        task[json_field] = json.loads(task[json_field])
                    except (json.JSONDecodeError, TypeError):
                        pass
            prompt_info = task_manager.get_pending_prompt(task_id)
            if prompt_info:
                task["prompt"] = prompt_info["message"]
                task["prompt_login"] = prompt_info["login"]
            step_info = task_manager.get_step_info(task_id)
            if step_info:
                task["step"] = step_info["step"]
                task["total_steps"] = step_info["total_steps"]
                task["step_label"] = step_info["label"]
            active = task_manager.get_active_count(task_id)
            if active > 0:
                task["active_count"] = active
            acc_results = task_manager.get_account_results(task_id)
            if acc_results:
                task["account_results"] = {str(k): v for k, v in acc_results.items()}
            acc_steps = task_manager.get_account_steps(task_id)
            if acc_steps:
                task["account_steps"] = {str(k): v for k, v in acc_steps.items()}

            data_str = json.dumps(task)
            if data_str != last_data or task["status"] in ("completed", "failed", "cancelled"):
                last_data = data_str
                yield f"data: {data_str}\n\n"

            if task["status"] in ("completed", "failed", "cancelled"):
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/{task_id}/respond")
async def respond_to_prompt(task_id: str, body: dict):
    """Provide user input for a pending task prompt."""
    value = body.get("value", "")
    login = body.get("login", "")
    if not task_manager.respond(task_id, value, login):
        raise HTTPException(status_code=404, detail="No pending prompt for this task")
    return {"status": "ok"}


@router.delete("/{task_id}", status_code=204)
async def cancel_task(task_id: str):
    cancelled = task_manager.cancel(task_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Task not found or already finished")
