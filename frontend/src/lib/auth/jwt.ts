import { decodeJwt } from "jose";

export type AccessClaims = {
  sub: string;
  tenant_id: string;
  roles?: string[];
  permissions?: string[];
  type?: "access";
};

export function decodeAccess(token: string): AccessClaims | null {
  try {
    return decodeJwt(token) as AccessClaims;
  } catch {
    return null;
  }
}
