import json
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/api/settings", tags=["settings"])

SETTINGS_FILE = settings.data_dir / "settings.json"

DEFAULTS = {
    "validation": {
        "fetch_profile": True,
        "check_ban": True,
        "max_threads": 5,
        "auto_revalidate_browser": True,
        "auto_proxy_on_import": False,
        "auto_validate_on_import": False,
        "auto_proxy_on_import_mafile": True,
        "auto_proxy_on_import_logpass": True,
        "auto_proxy_on_import_token": True,
        "auto_validate_on_import_mafile": True,
        "auto_validate_on_import_logpass": True,
        "auto_validate_on_import_token": True,
    },
    "display": {
        "hide_passwords": False,
    },
    "columns": {
        "browser": True,
        "profile": True,
        "steam_id": True,
        "login": True,
        "password": True,
        "login_pass": True,
        "email": True,
        "phone": True,
        "status": True,
        "ban": True,
        "twofa": True,
        "mafile": True,
        "proxy": True,
        "actions": True,
    },
    "logpass_columns": {
        "browser": True,
        "profile": True,
        "steam_id": True,
        "login": True,
        "password": True,
        "login_pass": True,
        "status": True,
        "ban": True,
        "prime": True,
        "trophy": True,
        "behavior": True,
        "license": True,
        "proxy": True,
        "notes": True,
        "actions": True,
    },
    "token_columns": {
        "browser": True,
        "profile": True,
        "last_online": True,
        "steam_id": True,
        "login": True,
        "token": True,
        "status": True,
        "proxy": True,
        "notes": True,
        "actions": True,
    },
}


def _read() -> dict:
    if SETTINGS_FILE.exists():
        return json.loads(SETTINGS_FILE.read_text("utf-8"))
    return DEFAULTS.copy()


def _write(data: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")


class ValidationSettings(BaseModel):
    fetch_profile: bool = True
    check_ban: bool = True
    max_threads: int = 5
    auto_revalidate_browser: bool = True
    auto_proxy_on_import: bool = False
    auto_validate_on_import: bool = False
    auto_proxy_on_import_mafile: bool = True
    auto_proxy_on_import_logpass: bool = True
    auto_proxy_on_import_token: bool = True
    auto_validate_on_import_mafile: bool = True
    auto_validate_on_import_logpass: bool = True
    auto_validate_on_import_token: bool = True


class DisplaySettings(BaseModel):
    hide_passwords: bool = False


class ColumnSettings(BaseModel):
    browser: bool = True
    profile: bool = True
    steam_id: bool = True
    login: bool = True
    password: bool = True
    login_pass: bool = True
    email: bool = True
    phone: bool = True
    status: bool = True
    ban: bool = True
    twofa: bool = True
    mafile: bool = True
    proxy: bool = True
    actions: bool = True
    last_online: bool = True


@router.get("/validation", response_model=ValidationSettings)
async def get_validation_settings():
    data = _read()
    return data.get("validation", DEFAULTS["validation"])


@router.put("/validation", response_model=ValidationSettings)
async def update_validation_settings(body: ValidationSettings):
    data = _read()
    data["validation"] = body.model_dump()
    _write(data)
    return data["validation"]


@router.get("/display", response_model=DisplaySettings)
async def get_display_settings():
    data = _read()
    return data.get("display", DEFAULTS["display"])


@router.put("/display", response_model=DisplaySettings)
async def update_display_settings(body: DisplaySettings):
    data = _read()
    data["display"] = body.model_dump()
    _write(data)
    return data["display"]


@router.get("/columns", response_model=ColumnSettings)
async def get_column_settings():
    data = _read()
    return data.get("columns", DEFAULTS["columns"])


@router.put("/columns", response_model=ColumnSettings)
async def update_column_settings(body: ColumnSettings):
    data = _read()
    data["columns"] = body.model_dump()
    _write(data)
    return data["columns"]


class LogpassColumnSettings(BaseModel):
    browser: bool = True
    profile: bool = True
    steam_id: bool = True
    login: bool = True
    password: bool = True
    login_pass: bool = True
    status: bool = True
    ban: bool = True
    prime: bool = True
    trophy: bool = True
    behavior: bool = True
    license: bool = True
    proxy: bool = True
    notes: bool = True
    actions: bool = True
    last_online: bool = True


@router.get("/logpass-columns", response_model=LogpassColumnSettings)
async def get_logpass_column_settings():
    data = _read()
    return data.get("logpass_columns", DEFAULTS["logpass_columns"])


@router.put("/logpass-columns", response_model=LogpassColumnSettings)
async def update_logpass_column_settings(body: LogpassColumnSettings):
    data = _read()
    data["logpass_columns"] = body.model_dump()
    _write(data)
    return data["logpass_columns"]


class TokenColumnSettings(BaseModel):
    browser: bool = True
    profile: bool = True
    last_online: bool = True
    steam_id: bool = True
    login: bool = True
    token: bool = True
    status: bool = True
    proxy: bool = True
    notes: bool = True
    actions: bool = True


@router.get("/token-columns", response_model=TokenColumnSettings)
async def get_token_column_settings():
    data = _read()
    return data.get("token_columns", DEFAULTS["token_columns"])


@router.put("/token-columns", response_model=TokenColumnSettings)
async def update_token_column_settings(body: TokenColumnSettings):
    data = _read()
    data["token_columns"] = body.model_dump()
    _write(data)
    return data["token_columns"]
