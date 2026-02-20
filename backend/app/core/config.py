from pydantic_settings import BaseSettings, SettingsConfigDict


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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
