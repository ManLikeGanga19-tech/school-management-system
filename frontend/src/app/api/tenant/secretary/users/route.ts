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
  const [usersRes, meRes] = await Promise.all([
    backendFetch("/api/v1/admin/users", { method: "GET" }),
    backendFetch("/api/v1/auth/me", { method: "GET" }),
  ]);

  const [usersRaw, meRaw] = await Promise.all([
    usersRes.json().catch(() => []),
    meRes.json().catch(() => null),
  ]);

  const users = asList(usersRaw);
  const me = asObject(meRaw);

  return NextResponse.json(
    {
      users,
      me,
      health: {
        users: usersRes.ok,
        me: meRes.ok,
      },
    },
    { status: 200 }
  );
}
