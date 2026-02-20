import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

function asList<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asObject<T extends Record<string, unknown>>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

export async function GET() {
  const safeFetch = async (path: string) => {
    try {
      return await backendFetch(path, { method: "GET" });
    } catch {
      return new Response(JSON.stringify({ detail: `Upstream unavailable: ${path}` }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
  };

  const [meRes, summaryRes, enrollmentsRes, invoicesRes, policyRes, usersRes, auditRes] =
    await Promise.all([
      safeFetch("/api/v1/auth/me"),
      safeFetch("/api/v1/admin/summary"),
      safeFetch("/api/v1/enrollments/"),
      safeFetch("/api/v1/finance/invoices"),
      safeFetch("/api/v1/finance/policy"),
      safeFetch("/api/v1/admin/users"),
      safeFetch("/api/v1/audit/logs?limit=20&offset=0"),
    ]);

  const [
    meRaw,
    summaryRaw,
    enrollmentsRaw,
    invoicesRaw,
    policyRaw,
    usersRaw,
    auditRaw,
  ] =
    await Promise.all([
      meRes.json().catch(() => null),
      summaryRes.json().catch(() => null),
      enrollmentsRes.json().catch(() => []),
      invoicesRes.json().catch(() => []),
      policyRes.json().catch(() => null),
      usersRes.json().catch(() => []),
      auditRes.json().catch(() => []),
    ]);

  const me = asObject(meRaw);
  const summary = asObject(summaryRaw);
  const enrollments = asList(enrollmentsRaw);
  const invoices = asList(invoicesRaw);
  const policy = asObject(policyRaw);
  const users = asList(usersRaw);
  const audit = asList(auditRaw);

  return NextResponse.json(
    {
      me,
      summary,
      enrollments,
      invoices,
      policy,
      users,
      audit,
      health: {
        me: meRes.ok,
        summary: summaryRes.ok,
        enrollments: enrollmentsRes.ok,
        invoices: invoicesRes.ok,
        policy: policyRes.ok,
        users: usersRes.ok,
        audit: auditRes.ok,
      },
    },
    { status: 200 }
  );
}
