import json
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


class AccountCreate(BaseModel):
    login: str
    password: str
    steam_id: str | None = None
    email: str | None = None
    email_password: str | None = None
    phone: str | None = None
    proxy: str | None = None
    notes: str | None = None


class AccountUpdate(BaseModel):
    login: str | None = None
    password: str | None = None
    steam_id: str | None = None
    email: str | None = None
    email_password: str | None = None
    phone: str | None = None
    proxy: str | None = None
    status: str | None = None
    notes: str | None = None


class AccountOut(BaseModel):
    id: int
    login: str
    password: str
    steam_id: str | None = None
    email: str | None = None
    email_password: str | None = None
    phone: str | None = None
    mafile_path: str | None = None
    shared_secret: str | None = None
    identity_secret: str | None = None
    proxy: str | None = None
    status: str
    notes: str | None = None
    nickname: str | None = None
    avatar_url: str | None = None
    steam_level: int | None = None
    last_online: str | None = None
    auto_accept: int = 0
    ban_status: str | None = None
    has_cookies: bool = False
    has_revocation_code: bool = False
    created_at: str
    updated_at: str

    @staticmethod
    def _check_revocation_code(mafile_path: str | None) -> bool:
        if not mafile_path:
            return False
        try:
            p = Path(mafile_path)
            if not p.exists():
                return False
            data = json.loads(p.read_text(encoding="utf-8"))
            return bool(data.get("revocation_code", ""))
        except Exception:
            return False

    @model_validator(mode="before")
    @classmethod
    def _compute_flags(cls, data):
        if isinstance(data, dict):
            data["has_cookies"] = bool(data.get("session_cookies"))
            data["has_revocation_code"] = AccountOut._check_revocation_code(data.get("mafile_path"))
        return data


class ProxyCreate(BaseModel):
    address: str
    protocol: str = "http"


class ProxyOut(BaseModel):
    id: int
    address: str
    protocol: str
    is_alive: bool
    last_checked: str | None = None
    fail_count: int


class MafileSession(BaseModel):
    SessionID: str = ""
    AccessToken: str = ""
    RefreshToken: str = ""
    SteamID: int = 0
    SteamLoginSecure: str = ""


class MafileData(BaseModel):
    shared_secret: str
    serial_number: str = ""
    revocation_code: str = ""
    uri: str = ""
    account_name: str = ""
    token_gid: str = ""
    identity_secret: str = ""
    secret_1: str = ""
    device_id: str = ""
    server_time: str = ""
    fully_enrolled: bool = False
    Session: MafileSession = Field(default_factory=MafileSession)


class TaskOut(BaseModel):
    id: str
    type: str
    status: str
    progress: int
    total: int
    result: str | None = None
    error: str | None = None
    account_ids: str | None = None
    account_results: str | None = None
    created_at: str
    updated_at: str


class ActionRequest(BaseModel):
    account_ids: list[int]
    action: str
    params: dict | None = None


class BulkImportResult(BaseModel):
    imported: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Log:pass accounts
# ---------------------------------------------------------------------------

class LogpassAccountCreate(BaseModel):
    login: str
    password: str
    steam_id: str | None = None
    proxy: str | None = None
    ban_status: str | None = None
    prime: str | None = None
    trophy: str | None = None
    behavior: str | None = None
    license: str | None = None
    notes: str | None = None


class LogpassAccountUpdate(BaseModel):
    login: str | None = None
    password: str | None = None
    steam_id: str | None = None
    proxy: str | None = None
    status: str | None = None
    ban_status: str | None = None
    nickname: str | None = None
    steam_level: int | None = None
    prime: str | None = None
    trophy: str | None = None
    behavior: str | None = None
    license: str | None = None
    notes: str | None = None


class LogpassAccountOut(BaseModel):
    id: int
    login: str
    password: str
    steam_id: str | None = None
    proxy: str | None = None
    status: str
    ban_status: str | None = None
    nickname: str | None = None
    steam_level: int | None = None
    prime: str | None = None
    trophy: str | None = None
    behavior: str | None = None
    license: str | None = None
    notes: str | None = None
    avatar_url: str | None = None
    last_online: str | None = None
    has_cookies: bool = False
    created_at: str
    updated_at: str

    @model_validator(mode="before")
    @classmethod
    def _compute_has_cookies(cls, data):
        if isinstance(data, dict):
            data["has_cookies"] = bool(data.get("session_cookies"))
        return data


# ---------------------------------------------------------------------------
# Token accounts
# ---------------------------------------------------------------------------

class TokenAccountCreate(BaseModel):
    login: str | None = None
    token: str
    steam_id: str | None = None
    proxy: str | None = None
    notes: str | None = None


class TokenAccountUpdate(BaseModel):
    login: str | None = None
    token: str | None = None
    steam_id: str | None = None
    proxy: str | None = None
    status: str | None = None
    notes: str | None = None


class TokenAccountOut(BaseModel):
    id: int
    login: str | None = None
    token: str
    steam_id: str | None = None
    proxy: str | None = None
    status: str
    ban_status: str | None = None
    nickname: str | None = None
    steam_level: int | None = None
    avatar_url: str | None = None
    last_online: str | None = None
    has_cookies: bool = False
    notes: str | None = None
    created_at: str
    updated_at: str

    @model_validator(mode="before")
    @classmethod
    def _compute_has_cookies(cls, data):
        if isinstance(data, dict):
            data["has_cookies"] = bool(data.get("session_cookies"))
        return data
