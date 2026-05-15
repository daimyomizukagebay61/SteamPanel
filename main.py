import mimetypes
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api import (
    accounts,
    actions,
    auto_accept,
    browser,
    logpass,
    logs,
    mafile_tools,
    proxies,
    tasks,
    token_accounts,
)
from app.api import settings as settings_api
from app.config import settings
from app.core.auto_accept import auto_accept_manager
from app.core.logging import setup_logging
from app.core.proxy_manager import proxy_manager
from app.database import close_db, get_db
from app.services.registry import register_all_handlers
from version import VERSION

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    from app.api.logs import install_log_sink

    install_log_sink()
    db = await get_db()

    # Clean up stale tasks left from a previous unclean shutdown
    stale = await db.execute(
        "UPDATE tasks SET status = 'cancelled', error = 'Server restarted', updated_at = datetime('now') "
        "WHERE status = 'running'"
    )
    if stale.rowcount:
        logger.info(f"Startup cleanup: cancelled {stale.rowcount} stale task(s)")
    # Clear per-account result icons so they don't persist after restart
    await db.execute(
        "UPDATE tasks SET account_results = NULL WHERE account_results IS NOT NULL"
    )
    await db.commit()

    await proxy_manager.load()
    register_all_handlers()

    # Resume auto-accept for accounts that had it enabled
    cursor = await db.execute("SELECT * FROM accounts WHERE auto_accept = 1")
    rows = await cursor.fetchall()
    for row in rows:
        account = dict(row)
        if account.get("shared_secret"):
            await auto_accept_manager.start(account)

    yield

    await auto_accept_manager.stop_all()
    await close_db()


app = FastAPI(
    title=settings.app_name,
    version=VERSION,
    docs_url="/docs" if settings.debug else None,
    lifespan=lifespan,
)


@app.get("/api/version")
async def get_version():
    return {"version": VERSION}


app.include_router(accounts.router)
app.include_router(actions.router)
app.include_router(proxies.router)
app.include_router(tasks.router)
app.include_router(mafile_tools.router)
app.include_router(logs.router)
app.include_router(auto_accept.router)
app.include_router(browser.router)
app.include_router(settings_api.router)
app.include_router(logpass.router)
app.include_router(token_accounts.router)

static_dir = settings.base_dir / "app" / "static"
static_dir.mkdir(parents=True, exist_ok=True)

_MIME = {".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml"}


@app.get("/", include_in_schema=False)
async def serve_root():
    return FileResponse(
        str(static_dir / "index.html"),
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@app.get("/assets/{filename:path}", include_in_schema=False)
async def serve_asset(filename: str):
    from fastapi import HTTPException

    file_path = static_dir / "assets" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404)
    ext = "." + filename.rsplit(".", 1)[-1] if "." in filename else ""
    media_type = _MIME.get(ext, "application/octet-stream")
    return FileResponse(
        str(file_path),
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")


def find_free_port(start: int = 8000, limit: int = 200) -> int:
    """Return the first free TCP port starting from `start`."""
    for port in range(start, start + limit):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port in range {start}–{start + limit - 1}")


if __name__ == "__main__":
    import threading
    import time
    import webbrowser

    import uvicorn

    # Install log intercept before uvicorn.run() so the first two startup
    # lines (Started server process / Waiting for application startup) are
    # captured by our formatter instead of printing raw.
    setup_logging()

    port = find_free_port(settings.port)
    url = f"http://{settings.host}:{port}"
    tg = "@lolzdm  ->  https://t.me/lolzdm"

    val_w = max(len(url), len(tg))
    inner = val_w + 8  # " URL | " (7) + value + " " (1)

    banner = (
        "\n"
        "\033[34m"
        "  ╔═╗╔╦╗╔═╗╔═╗╔╦╗╔═╗╔═╗╔╗╔╔═╗╦\n"
        "  ╚═╗ ║ ║╣ ╠═╣║║║╠═╝╠═╣║║║║╣ ║\n"
        "  ╚═╝ ╩ ╚═╝╩ ╩╩ ╩╩  ╩ ╩╝╚╝╚═╝╩═╝"
        f"\033[0m \033[90mv{VERSION}\033[0m\n\n"
        f"  \033[90m┌{'─' * inner}┐\033[0m\n"
        f"  \033[90m│\033[0m\033[34m URL \033[90m│\033[0m {url:<{val_w + 1}}\033[90m│\033[0m\n"
        f"  \033[90m│\033[0m\033[34m  TG \033[90m│\033[0m {tg:<{val_w + 1}}\033[90m│\033[0m\n"
        f"  \033[90m└{'─' * inner}┘\033[0m\n"
    )
    print(banner)

    def _open_browser():
        time.sleep(1.5)
        webbrowser.open(url)

    threading.Thread(target=_open_browser, daemon=True).start()

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=port,
        reload=settings.debug,
        log_config=None,
    )
