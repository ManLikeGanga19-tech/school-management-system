import { apiFetch } from "@/lib/api";

export type AuditLogRow = {
  id: string;
  tenant_id: string;
  actor_user_id?: string | null;
  action: string;
  resource: string;
  resource_id?: string | null;
  payload?: any;
  meta?: any;
  created_at: string;
};

export type AuditListResponse = {
  items: AuditLogRow[];
  total: number;
  limit: number;
  offset: number;
};

export type AuditListParams = {
  tenant_id?: string;
  actor_user_id?: string;
  action?: string;
  resource?: string;
  resource_id?: string;
  request_id?: string;
  from_dt?: string; // ISO
  to_dt?: string;   // ISO
  q?: string;
  limit?: number;
  offset?: number;
};

export async function listAuditLogs(params: AuditListParams) {
  const qs = new URLSearchParams();

  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  });

  return apiFetch<AuditListResponse>(`/api/v1/admin/audit/logs?${qs.toString()}`, {
    method: "GET",
    tenantRequired: false, // SaaS endpoint
  });
}

export async function getAuditLog(logId: string) {
  return apiFetch<AuditLogRow>(`/api/v1/admin/audit/logs/${encodeURIComponent(logId)}`, {
    method: "GET",
    tenantRequired: false,
  });
}