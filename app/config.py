from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "SteamPanel"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8000

    base_dir: Path = Path(__file__).resolve().parent.parent
    data_dir: Path = base_dir / "data"
    db_path: Path = data_dir / "accounts.db"
    mafiles_dir: Path = data_dir / "mafiles"
    logs_dir: Path = data_dir / "logs"
    proxies_path: Path = data_dir / "proxies.json"

    max_concurrent_tasks: int = 5
    request_timeout: int = 30
    proxy_rotation_interval: int = 60

    model_config = {"env_prefix": "STEAM_PANEL_"}


settings = Settings()


# Defaults for data/settings.json → "validation" section
_VALIDATION_DEFAULTS: dict = {
    "fetch_profile": True,
    "check_ban": True,
    "max_threads": 10,
    "account_timeout": 90,
    "auto_revalidate_browser": True,
}


def read_validation_settings() -> dict:
    """Read the 'validation' section from data/settings.json (sync, for small file)."""
    import json as _json

    settings_path = settings.data_dir / "settings.json"
    result = _VALIDATION_DEFAULTS.copy()
    if settings_path.exists():
        try:
            data = _json.loads(settings_path.read_text("utf-8"))
            result.update(data.get("validation", {}))
        except Exception:
            pass
    return result
