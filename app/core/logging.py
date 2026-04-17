import logging
import re
import sys

from loguru import logger

from app.config import settings


LEVEL_ICONS = {
    "TRACE":   "[~]",
    "DEBUG":   "[.]",
    "INFO":    "[i]",
    "SUCCESS": "[+]",
    "WARNING": "[!]",
    "ERROR":   "[e]",
    "CRITICAL":"[e]",
}

LEVEL_COLORS = {
    "TRACE":   "\033[35m",
    "DEBUG":   "\033[37m",
    "INFO":    "\033[34m",
    "SUCCESS": "\033[32m",
    "WARNING": "\033[33m",
    "ERROR":   "\033[31m",
    "CRITICAL":"\033[31m",
}
RESET = "\033[0m"


def _loguru_fmt(record: dict) -> str:
    level = record["level"].name
    icon = LEVEL_ICONS.get(level, "[i]")
    color = LEVEL_COLORS.get(level, "")
    ts = record["time"].strftime("%H:%M:%S")
    msg = record["message"].replace("<", "\\<").replace("{", "{{").replace("}", "}}")
    return f"{RESET}[{ts}] {color}{icon}{RESET} {msg}\n"


class _UvicornInterceptHandler(logging.Handler):
    """Route all standard logging records (uvicorn, fastapi) into loguru."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        frame, depth = sys._getframe(6), 6
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


_logging_configured = False


def setup_logging() -> None:
    global _logging_configured
    if _logging_configured:
        return
    _logging_configured = True

    logger.remove()

    logger.add(
        sys.stderr,
        format=_loguru_fmt,
        level="DEBUG" if settings.debug else "INFO",
        colorize=False,
    )

    settings.logs_dir.mkdir(parents=True, exist_ok=True)

    def _file_fmt(record: dict) -> str:
        level = record["level"].name
        icon = LEVEL_ICONS.get(level, "[i]")
        ts = record["time"].strftime("%Y-%m-%d %H:%M:%S")
        msg = record["message"].replace("<", "\\<").replace("{", "{{").replace("}", "}}")
        return f"[{ts}] {icon} {msg}\n"

    logger.add(
        settings.logs_dir / "steampanel_{time:YYYY-MM-DD}.log",
        format=_file_fmt,
        level="DEBUG",
        rotation="1 day",
        retention="7 days",
        compression="zip",
    )

    _install_intercept()


class _AioSQLiteFilter(logging.Filter):
    """Reformats raw aiosqlite debug messages into readable DB operation lines."""

    _OP_RE = re.compile(r"method (\w+) of sqlite3\.(\w+)")
    _SQL_RE = re.compile(r',\s*"(.*?)"(?:,\s*(\(.*?\)))?\s*\)$', re.DOTALL)

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        # Drop the redundant "operation X completed" lines
        if " completed" in msg:
            return False
        if msg.startswith("executing"):
            op_m = self._OP_RE.search(msg)
            method = op_m.group(1).upper() if op_m else "OP"
            sql_m = self._SQL_RE.search(msg)
            if sql_m:
                sql = sql_m.group(1).strip()
                params = sql_m.group(2) or ""
                record.msg = f"[DB] {sql}" + (f"  {params}" if params else "")
            else:
                record.msg = f"[DB] {method}"
            record.args = ()
        return True


def _install_intercept() -> None:
    intercept = _UvicornInterceptHandler()
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        log = logging.getLogger(name)
        log.handlers = [intercept]
        log.setLevel(logging.DEBUG)
        log.propagate = False

    # Format aiosqlite SQL logs instead of silencing them
    aiosqlite_log = logging.getLogger("aiosqlite")
    aiosqlite_log.setLevel(logging.DEBUG)
    aiosqlite_log.addFilter(_AioSQLiteFilter())

    logging.getLogger("asyncio").setLevel(logging.WARNING)



