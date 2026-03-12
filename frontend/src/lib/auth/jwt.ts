import { decodeJwt } from "jose";

export type AccessClaims = {
  sub: string;
  tenant_id: string;
  roles?: string[];
  permissions?: string[];
  type?: "access";
  exp?: number;
};

export function decodeAccess(token: string): AccessClaims | null {
  try {
    return decodeJwt(token) as AccessClaims;
  } catch {
    return null;
  }
}

export function isJwtLive(token: string | null | undefined, skewSeconds = 30): boolean {
  if (!token) return false;
  const claims = decodeAccess(token);
  if (!claims) return false;
  if (typeof claims.exp !== "number") return true;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return claims.exp > nowSeconds + skewSeconds;
}
