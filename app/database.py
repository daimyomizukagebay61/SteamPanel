import asyncio
from pathlib import Path

import aiosqlite
from loguru import logger

from app.config import settings

_db: aiosqlite.Connection | None = None
_db_lock = asyncio.Lock()

SQL_CREATE_ACCOUNTS = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL,
    password TEXT NOT NULL,
    steam_id TEXT UNIQUE,
    email TEXT,
    email_password TEXT,
    phone TEXT,
    mafile_path TEXT,
    shared_secret TEXT,
    identity_secret TEXT,
    proxy TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    notes TEXT,
    nickname TEXT,
    avatar_url TEXT,
    steam_level INTEGER,
    auto_accept INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SQL_CREATE_PROXIES = """
CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL UNIQUE,
    protocol TEXT NOT NULL DEFAULT 'http',
    is_alive INTEGER NOT NULL DEFAULT 1,
    last_checked TEXT,
    fail_count INTEGER NOT NULL DEFAULT 0
);
"""

SQL_CREATE_TASKS = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SQL_CREATE_LOGPASS_ACCOUNTS = """
CREATE TABLE IF NOT EXISTS logpass_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    steam_id TEXT,
    proxy TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    ban_status TEXT,
    nickname TEXT,
    steam_level INTEGER,
    prime TEXT,
    trophy TEXT,
    behavior TEXT,
    license TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SQL_CREATE_TOKEN_ACCOUNTS = """
CREATE TABLE IF NOT EXISTS token_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT,
    token TEXT NOT NULL,
    steam_id TEXT,
    status TEXT NOT NULL DEFAULT 'unknown',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


async def get_db() -> aiosqlite.Connection:
    global _db
    async with _db_lock:
        if _db is None:
            settings.data_dir.mkdir(parents=True, exist_ok=True)
            _db = await aiosqlite.connect(str(settings.db_path))
            _db.row_factory = aiosqlite.Row
            await _db.execute("PRAGMA journal_mode=WAL")
            await _db.execute("PRAGMA foreign_keys=ON")
            await _init_tables(_db)
            logger.info(f"Database connected: {settings.db_path}")
    return _db


async def _init_tables(db: aiosqlite.Connection) -> None:
    await db.execute(SQL_CREATE_ACCOUNTS)
    await db.execute(SQL_CREATE_PROXIES)
    await db.execute(SQL_CREATE_TASKS)
    await db.execute(SQL_CREATE_LOGPASS_ACCOUNTS)
    await db.execute(SQL_CREATE_TOKEN_ACCOUNTS)
    await _migrate(db)
    await db.commit()
    await _fix_mafile_paths(db)


async def _migrate(db: aiosqlite.Connection) -> None:
    """Add columns that may not exist in older DBs."""
    cursor = await db.execute("PRAGMA table_info(accounts)")
    cols = {row[1] for row in await cursor.fetchall()}
    migrations = [
        ("nickname", "ALTER TABLE accounts ADD COLUMN nickname TEXT"),
        ("avatar_url", "ALTER TABLE accounts ADD COLUMN avatar_url TEXT"),
        ("steam_level", "ALTER TABLE accounts ADD COLUMN steam_level INTEGER"),
        (
            "auto_accept",
            "ALTER TABLE accounts ADD COLUMN auto_accept INTEGER NOT NULL DEFAULT 0",
        ),
        ("ban_status", "ALTER TABLE accounts ADD COLUMN ban_status TEXT"),
        ("session_cookies", "ALTER TABLE accounts ADD COLUMN session_cookies TEXT"),
        ("last_online", "ALTER TABLE accounts ADD COLUMN last_online TEXT"),
        ("vac_status", "ALTER TABLE accounts ADD COLUMN vac_status TEXT"),
        ("limit_status", "ALTER TABLE accounts ADD COLUMN limit_status TEXT"),
        ("vac_games", "ALTER TABLE accounts ADD COLUMN vac_games TEXT"),
        ("auto_confirm", "ALTER TABLE accounts ADD COLUMN auto_confirm INTEGER NOT NULL DEFAULT 0"),
        ("balance", "ALTER TABLE accounts ADD COLUMN balance TEXT"),
        ("country", "ALTER TABLE accounts ADD COLUMN country TEXT"),
    ]
    for col, sql in migrations:
        if col not in cols:
            await db.execute(sql)
            logger.info(f"Migration: added column '{col}' to accounts")

    cursor = await db.execute("PRAGMA table_info(tasks)")
    task_cols = {row[1] for row in await cursor.fetchall()}
    task_migrations = [
        ("account_ids", "ALTER TABLE tasks ADD COLUMN account_ids TEXT"),
        ("account_results", "ALTER TABLE tasks ADD COLUMN account_results TEXT"),
    ]
    for col, sql in task_migrations:
        if col not in task_cols:
            await db.execute(sql)
            logger.info(f"Migration: added column '{col}' to tasks")

    # Logpass accounts migrations
    cursor = await db.execute("PRAGMA table_info(logpass_accounts)")
    lp_cols = {row[1] for row in await cursor.fetchall()}
    lp_migrations = [
        ("prime", "ALTER TABLE logpass_accounts ADD COLUMN prime TEXT"),
        ("trophy", "ALTER TABLE logpass_accounts ADD COLUMN trophy TEXT"),
        ("behavior", "ALTER TABLE logpass_accounts ADD COLUMN behavior TEXT"),
        ("license", "ALTER TABLE logpass_accounts ADD COLUMN license TEXT"),
        (
            "session_cookies",
            "ALTER TABLE logpass_accounts ADD COLUMN session_cookies TEXT",
        ),
        ("steam_level", "ALTER TABLE logpass_accounts ADD COLUMN steam_level INTEGER"),
        ("avatar_url", "ALTER TABLE logpass_accounts ADD COLUMN avatar_url TEXT"),
        ("last_online", "ALTER TABLE logpass_accounts ADD COLUMN last_online TEXT"),
        ("vac_status", "ALTER TABLE logpass_accounts ADD COLUMN vac_status TEXT"),
        ("limit_status", "ALTER TABLE logpass_accounts ADD COLUMN limit_status TEXT"),
        ("vac_games", "ALTER TABLE logpass_accounts ADD COLUMN vac_games TEXT"),
        ("balance", "ALTER TABLE logpass_accounts ADD COLUMN balance TEXT"),
        ("country", "ALTER TABLE logpass_accounts ADD COLUMN country TEXT"),
    ]
    for col, sql in lp_migrations:
        if col not in lp_cols:
            await db.execute(sql)
            logger.info(f"Migration: added column '{col}' to logpass_accounts")

    # Token accounts migrations
    cursor = await db.execute("PRAGMA table_info(token_accounts)")
    tk_cols = {row[1] for row in await cursor.fetchall()}
    tk_migrations = [
        ("proxy", "ALTER TABLE token_accounts ADD COLUMN proxy TEXT"),
        (
            "session_cookies",
            "ALTER TABLE token_accounts ADD COLUMN session_cookies TEXT",
        ),
        ("ban_status", "ALTER TABLE token_accounts ADD COLUMN ban_status TEXT"),
        ("nickname", "ALTER TABLE token_accounts ADD COLUMN nickname TEXT"),
        ("steam_level", "ALTER TABLE token_accounts ADD COLUMN steam_level INTEGER"),
        ("avatar_url", "ALTER TABLE token_accounts ADD COLUMN avatar_url TEXT"),
        ("last_online", "ALTER TABLE token_accounts ADD COLUMN last_online TEXT"),
        ("check_data", "ALTER TABLE token_accounts ADD COLUMN check_data TEXT"),
        ("vac_status", "ALTER TABLE token_accounts ADD COLUMN vac_status TEXT"),
        ("limit_status", "ALTER TABLE token_accounts ADD COLUMN limit_status TEXT"),
        ("vac_games", "ALTER TABLE token_accounts ADD COLUMN vac_games TEXT"),
        ("balance", "ALTER TABLE token_accounts ADD COLUMN balance TEXT"),
        ("country", "ALTER TABLE token_accounts ADD COLUMN country TEXT"),
    ]
    for col, sql in tk_migrations:
        if col not in tk_cols:
            await db.execute(sql)
            logger.info(f"Migration: added column '{col}' to token_accounts")

    # Add UNIQUE index on login if missing
    cursor = await db.execute("PRAGMA index_list(logpass_accounts)")
    idx_rows = await cursor.fetchall()
    idx_names = {row[1] for row in idx_rows}
    if "uq_logpass_login" not in idx_names:
        try:
            await db.execute(
                "CREATE UNIQUE INDEX uq_logpass_login ON logpass_accounts(login)"
            )
            logger.info("Migration: added unique index on logpass_accounts.login")
        except Exception:
            logger.warning(
                "Could not create unique index on logpass_accounts.login (duplicates may exist)"
            )


async def _fix_mafile_paths(db: aiosqlite.Connection) -> None:
    """Repair mafile_path entries that point to the wrong directory.

    This happens when the user moves the SteamPanel folder — absolute paths
    stored in the DB become invalid. We try to re-locate each mafile by
    filename inside the current mafiles_dir.
    """
    cursor = await db.execute(
        "SELECT id, login, mafile_path FROM accounts WHERE mafile_path IS NOT NULL AND mafile_path != ''"
    )
    rows = await cursor.fetchall()
    fixed = 0
    for row in rows:
        old_path = Path(row["mafile_path"])
        if old_path.exists():
            continue  # still valid
        # Try to find the file by name in current mafiles_dir
        candidate = settings.mafiles_dir / old_path.name
        if candidate.exists():
            await db.execute(
                "UPDATE accounts SET mafile_path = ? WHERE id = ?",
                (str(candidate), row["id"]),
            )
            fixed += 1
            logger.info(
                f"[db] Fixed mafile path for {row['login']}: {old_path} -> {candidate}"
            )
        else:
            logger.warning(
                f"[db] mafile not found for {row['login']}: {old_path} "
                f"(also checked {candidate})"
            )
    if fixed:
        await db.commit()
        logger.info(f"[db] Repaired {fixed} mafile path(s)")


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None
        logger.info("Database connection closed")
