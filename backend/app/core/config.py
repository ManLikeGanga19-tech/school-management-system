from pathlib import Path

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    _HAS_PYDANTIC_SETTINGS = True
except Exception:  # pragma: no cover - compatibility fallback
    from pydantic import BaseSettings  # type: ignore

    SettingsConfigDict = None  # type: ignore
    _HAS_PYDANTIC_SETTINGS = False

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_FILE = str(_BACKEND_DIR / ".env")


class Settings(BaseSettings):
    APP_ENV: str = "dev"
    APP_NAME: str = "School Management System API"
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ACCESS_TTL_MIN: int = 15
    JWT_REFRESH_TTL_DAYS: int = 30
    TENANT_MODE: str = "domain"

    # Conservative defaults for local/dev and safe production baseline.
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT_SEC: int = 30
    DB_POOL_RECYCLE_SEC: int = 1800
    DB_POOL_PRE_PING: bool = True

    # Daraja (M-Pesa STK) integration
    DARAJA_ENV: str = "sandbox"  # sandbox | production
    DARAJA_CONSUMER_KEY: str = ""
    DARAJA_CONSUMER_SECRET: str = ""
    DARAJA_SHORTCODE: str = ""
    DARAJA_PASSKEY: str = ""
    DARAJA_CALLBACK_BASE_URL: str = ""
    DARAJA_CALLBACK_TOKEN: str = ""
    DARAJA_TIMEOUT_SEC: int = 30
    DARAJA_USE_MOCK: bool = False
    DARAJA_SANDBOX_FALLBACK_TO_MOCK: bool = False

    if _HAS_PYDANTIC_SETTINGS:
        model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")
    else:
        class Config:
            env_file = _ENV_FILE
            extra = "ignore"


settings = Settings()
