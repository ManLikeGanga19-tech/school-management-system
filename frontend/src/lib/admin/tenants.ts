// src/lib/admin/tenants.ts
import { apiFetch } from "@/lib/api";

/**
 * SaaS Tenants client
 * - SUPER_ADMIN operations => tenantRequired MUST be false
 */

export type TenantRow = {
  id: string;
  slug: string;
  name: string;
  primary_domain?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ListTenantsParams = {
  q?: string;
  is_active?: boolean;
};

export async function listTenants(params?: ListTenantsParams) {
  const qs = new URLSearchParams();

  if (params?.q && params.q.trim()) qs.set("q", params.q.trim());
  if (typeof params?.is_active === "boolean") qs.set("is_active", String(params.is_active));

  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<TenantRow[]>(`/api/v1/admin/tenants${suffix}`, {
    method: "GET",
    tenantRequired: false,
  });
}

export async function suspendTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/api/v1/admin/tenants/${encodeURIComponent(tenantId)}/suspend`, {
    method: "POST",
    tenantRequired: false,
  });
}

export async function restoreTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/api/v1/admin/tenants/${encodeURIComponent(tenantId)}/restore`, {
    method: "POST",
    tenantRequired: false,
  });
}

export async function deleteTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/api/v1/admin/tenants/${encodeURIComponent(tenantId)}`, {
    method: "DELETE",
    tenantRequired: false,
  });
}