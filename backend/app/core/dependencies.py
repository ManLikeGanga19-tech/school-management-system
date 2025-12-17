from fastapi import Request, Depends, HTTPException


def get_tenant(request: Request):
    tenant = getattr(request.state, "tenant", None)

    if not tenant:
        raise HTTPException(status_code=400, detail="Tenant context missing")

    return tenant
