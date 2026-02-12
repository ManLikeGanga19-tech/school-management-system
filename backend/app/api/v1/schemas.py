from pydantic import BaseModel, EmailStr
from typing import List, Optional


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeResponse(BaseModel):
    user: dict
    tenant: dict
    roles: List[str] = []
    permissions: List[str] = []
