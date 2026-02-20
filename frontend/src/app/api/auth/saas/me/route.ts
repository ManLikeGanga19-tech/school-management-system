import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const BACKEND =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://127.0.0.1:8000";

  const access = (await cookies()).get("sms_saas_access")?.value;

  if (!access) {
    return NextResponse.json({ detail: "Missing access token" }, { status: 401 });
  }

  const res = await fetch(`${BACKEND}/api/v1/auth/me/saas`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${access}`,
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  return NextResponse.json(data, { status: 200 });
}