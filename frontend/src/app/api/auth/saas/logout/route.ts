import { NextResponse } from "next/server";
import { clearSaasAuthCookies } from "@/lib/auth/cookies";

export async function POST() {
  await clearSaasAuthCookies();
  return NextResponse.json({ ok: true }, { status: 200 });
}