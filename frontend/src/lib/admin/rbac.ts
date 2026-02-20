// src/lib/admin/rbac.ts
import { apiFetch } from "@/lib/api";

/**
 * SaaS RBAC client (SUPER_ADMIN)
 * NOTE:
 * - All calls here are SaaS operations => tenantRequired MUST be false always.
 * - Routes are under /api/v1/admin/...
 */

export type PermissionRow = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  created_at?: string | null;
};

export type RoleRow = {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  created_at?: string | null;
};

// ----------------------------
// Permissions (SaaS)
// ----------------------------

export async function listPermissions() {
  return apiFetch<PermissionRow[]>("/api/v1/admin/rbac/permissions", {
    method: "GET",
    tenantRequired: false,
  });
}

export async function createPermission(payload: {
  code: string;
  name: string;
  description?: string;
}) {
  return apiFetch<{ ok: true; id: string }>("/api/v1/admin/rbac/permissions", {
    method: "POST",
    tenantRequired: false,
    body: JSON.stringify({
      code: payload.code?.trim(),
      name: payload.name?.trim(),
      description: payload.description?.trim() || undefined,
    }),
  });
}

export async function updatePermission(
  code: string,
  payload: { name?: string; description?: string }
) {
  return apiFetch<{ ok: true }>(
    `/api/v1/admin/rbac/permissions/${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      tenantRequired: false,
      body: JSON.stringify({
        name: payload.name?.trim(),
        description: payload.description?.trim() || undefined,
      }),
    }
  );
}

export async function deletePermission(code: string) {
  return apiFetch<{ ok: true }>(
    `/api/v1/admin/rbac/permissions/${encodeURIComponent(code)}`,
    {
      method: "DELETE",
      tenantRequired: false,
    }
  );
}

// ----------------------------
// Roles (SaaS)
// ----------------------------

export type RoleScopeFilter = "tenant" | "global" | "all";
export type RoleCreateScope = "tenant" | "global";

/**
 * Enterprise-safe listing:
 * - scope="global" => returns global roles (tenant_id = null). No tenantId required.
 * - scope="tenant" => requires tenantId, returns roles for that tenant only.
 * - scope="all" => requires tenantId, returns global + that tenant roles.
 */
export async function listRoles(
  scope: RoleScopeFilter = "global",
  opts?: { tenantId?: string | null }
) {
  const qs = new URLSearchParams({ scope });

  const tenantId = (opts?.tenantId ?? "")?.trim();

  // ✅ enterprise: fail fast so UI doesn't spam backend with invalid calls
  if (scope === "tenant" || scope === "all") {
    if (!tenantId) {
      throw new Error("tenantId is required for scope=tenant or scope=all");
    }
    qs.set("tenant_id", tenantId);
  }

  return apiFetch<RoleRow[]>(`/api/v1/admin/rbac/roles?${qs.toString()}`, {
    method: "GET",
    tenantRequired: false,
  });
}

/**
 * Create role:
 * - scope="global": creates platform/global role (tenant_id null)
 * - scope="tenant": requires tenantId
 */
export async function createRole(payload: {
  code: string;
  name: string;
  description?: string;
  scope: RoleCreateScope;
  tenantId?: string | null; // required when scope="tenant"
}) {
  const scope = payload.scope;
  const tenantId = (payload.tenantId ?? "")?.trim();

  // ✅ enterprise: enforce tenantId for tenant-scoped role creation
  if (scope === "tenant" && !tenantId) {
    throw new Error("tenantId is required when creating a tenant-scoped role");
  }

  return apiFetch<{ ok: true; id: string }>("/api/v1/admin/rbac/roles", {
    method: "POST",
    tenantRequired: false,
    body: JSON.stringify({
      code: payload.code?.trim(),
      name: payload.name?.trim(),
      description: payload.description?.trim() || undefined,
      scope,
      tenant_id: scope === "tenant" ? tenantId : undefined,
    }),
  });
}

export async function updateRole(
  roleId: string,
  payload: { name?: string; description?: string }
) {
  return apiFetch<{ ok: true }>(`/api/v1/admin/rbac/roles/${roleId}`, {
    method: "PATCH",
    tenantRequired: false,
    body: JSON.stringify({
      name: payload.name?.trim(),
      description: payload.description?.trim() || undefined,
    }),
  });
}

export async function deleteRole(roleId: string) {
  return apiFetch<{ ok: true }>(`/api/v1/admin/rbac/roles/${roleId}`, {
    method: "DELETE",
    tenantRequired: false,
  });
}

// ----------------------------
// Role Permissions (SaaS)
// ----------------------------

export async function getRolePermissions(roleId: string) {
  return apiFetch<{ role_id: string; permissions: string[] }>(
    `/api/v1/admin/rbac/roles/${roleId}/permissions`,
    { method: "GET", tenantRequired: false }
  );
}

/**
 * Adds permission codes to a role.
 * Backend expects a JSON array body: ["perm.a", "perm.b"]
 */
export async function addRolePermissions(roleId: string, permission_codes: string[]) {
  const codes = Array.from(
    new Set(
      (permission_codes || [])
        .map((c) => (c || "").trim())
        .filter(Boolean)
    )
  );

  return apiFetch<{ ok: true }>(`/api/v1/admin/rbac/roles/${roleId}/permissions`, {
    method: "POST",
    tenantRequired: false,
    body: JSON.stringify(codes),
  });
}

/**
 * Removes permission codes from a role.
 * Backend expects a JSON array body: ["perm.a", "perm.b"]
 */
export async function removeRolePermissions(roleId: string, permission_codes: string[]) {
  const codes = Array.from(
    new Set(
      (permission_codes || [])
        .map((c) => (c || "").trim())
        .filter(Boolean)
    )
  );

  return apiFetch<{ ok: true }>(`/api/v1/admin/rbac/roles/${roleId}/permissions`, {
    method: "DELETE",
    tenantRequired: false,
    body: JSON.stringify(codes),
  });
}