import asyncio
import json
from collections import deque
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from loguru import logger

router = APIRouter(prefix="/api/logs", tags=["logs"])

_LOG_BUFFER: deque[dict[str, Any]] = deque(maxlen=500)
_SUBSCRIBERS: list[asyncio.Queue] = []

LEVEL_ICONS = {
    "TRACE": "~",
    "DEBUG": ".",
    "INFO": "i",
    "SUCCESS": "+",
    "WARNING": "!",
    "ERROR": "e",
    "CRITICAL": "e",
}


def _log_sink(message: Any) -> None:
    record = message.record
    entry = {
        "ts": record["time"].strftime("%H:%M:%S"),
        "level": record["level"].name.lower(),
        "icon": LEVEL_ICONS.get(record["level"].name, "i"),
        "msg": record["message"],
    }
    _LOG_BUFFER.append(entry)
    for q in _SUBSCRIBERS[:]:
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            pass


def install_log_sink() -> None:
    logger.add(_log_sink, format="{message}", level="DEBUG", colorize=False)


@router.get("")
async def get_logs():
    return list(_LOG_BUFFER)


@router.get("/stream")
async def stream_logs():
    queue: asyncio.Queue = asyncio.Queue(maxsize=200)
    _SUBSCRIBERS.append(queue)

    async def event_generator():
        try:
            while True:
                entry = await queue.get()
                yield f"data: {json.dumps(entry, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if queue in _SUBSCRIBERS:
                _SUBSCRIBERS.remove(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
