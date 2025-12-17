from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_ENV: str = "dev"
    APP_NAME: str = "School Management System API"
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ACCESS_TTL_MIN: int = 15
    JWT_REFRESH_TTL_DAYS: int = 30
    TENANT_MODE: str = "domain"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
