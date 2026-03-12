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
  plan?: string | null;
  user_count?: number | null;
  admin_user_id?: string | null;
  admin_email?: string | null;
  admin_full_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type UpdateTenantPayload = {
  name?: string;
  slug?: string;
  primary_domain?: string | null;
  is_active?: boolean;
  admin_email?: string | null;
  admin_full_name?: string | null;
  admin_password?: string | null;
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
  return apiFetch<TenantRow[]>(`/admin/tenants${suffix}`, {
    method: "GET",
    tenantRequired: false,
  });
}

export async function suspendTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/admin/tenants/${encodeURIComponent(tenantId)}/suspend`, {
    method: "POST",
    tenantRequired: false,
  });
}

export async function restoreTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/admin/tenants/${encodeURIComponent(tenantId)}/restore`, {
    method: "POST",
    tenantRequired: false,
  });
}

export async function deleteTenant(tenantId: string) {
  return apiFetch<{ ok: true }>(`/admin/tenants/${encodeURIComponent(tenantId)}`, {
    method: "DELETE",
    tenantRequired: false,
  });
}

export async function updateTenant(tenantId: string, payload: UpdateTenantPayload) {
  return apiFetch<TenantRow>(`/admin/tenants/${encodeURIComponent(tenantId)}`, {
    method: "PATCH",
    tenantRequired: false,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
