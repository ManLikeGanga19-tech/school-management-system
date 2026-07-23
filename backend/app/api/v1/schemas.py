from pydantic import BaseModel, EmailStr
from typing import List, Optional


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Cloudflare Turnstile token. Optional so that clients which predate the
    # widget keep working while it rolls out; enforcement is controlled by
    # TURNSTILE_SECRET_KEY on the server, not by this field.
    turnstile_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user: dict
    tenant: dict
    roles: List[str] = []
    permissions: List[str] = []
