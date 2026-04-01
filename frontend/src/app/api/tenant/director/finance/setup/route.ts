/**
 * Lightweight director finance setup BFF — returns only catalogue data.
 * Director has read-only access to fee structures, categories, items and
 * scholarships.  Write actions are NOT exposed here (director manages
 * policy through the dedicated /policy endpoint).
 */
import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

async function safeFetch(path: string) {
  try {
    return await backendFetch(path, { method: "GET" });
  } catch {
    return new Response(
      JSON.stringify({ detail: `Upstream unavailable: ${path}` }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
  }
}

export async function GET() {
  const [categoriesRes, itemsRes, structuresRes, scholarshipsRes, policyRes] =
    await Promise.all([
      safeFetch("/api/v1/finance/fee-categories"),
      safeFetch("/api/v1/finance/fee-items"),
      safeFetch("/api/v1/finance/fee-structures"),
      safeFetch("/api/v1/finance/scholarships"),
      safeFetch("/api/v1/finance/policy"),
    ]);

  const [categoriesRaw, itemsRaw, structuresRaw, scholarshipsRaw, policyRaw] =
    await Promise.all([
      categoriesRes.json().catch(() => []),
      itemsRes.json().catch(() => []),
      structuresRes.json().catch(() => []),
      scholarshipsRes.json().catch(() => []),
      policyRes.json().catch(() => null),
    ]);

  const fee_structures: unknown[] = Array.isArray(structuresRaw)
    ? structuresRaw
    : [];

  const structureDetails = await Promise.all(
    fee_structures.map(async (s: unknown) => {
      const structure = s as Record<string, unknown>;
      const id = String(structure?.id ?? "").trim();
      if (!id) return null;
      const res = await safeFetch(
        `/api/v1/finance/fee-structures/${encodeURIComponent(id)}`
      );
      const detail = await res.json().catch(() => null);
      return { id, ok: res.ok, detail };
    })
  );

  const fee_structure_items: Record<
    string,
    {
      fee_item_id: string;
      amount: string | number;
      fee_item_code: string;
      fee_item_name: string;
      category_id: string;
      category_code: string;
      category_name: string;
    }[]
  > = {};

  for (const entry of structureDetails) {
    if (!entry || !entry.ok || !entry.detail) continue;
    const items = Array.isArray(
      (entry.detail as Record<string, unknown>).items
    )
      ? ((entry.detail as Record<string, unknown>).items as Record<
          string,
          unknown
        >[])
      : [];
    fee_structure_items[entry.id] = items.map((item) => ({
      fee_item_id: String(item?.fee_item_id ?? ""),
      term_1_amount: (item?.term_1_amount as string | number) ?? 0,
      term_2_amount: (item?.term_2_amount as string | number) ?? 0,
      term_3_amount: (item?.term_3_amount as string | number) ?? 0,
      charge_frequency: String(item?.charge_frequency ?? "PER_TERM"),
      fee_item_code: String(item?.fee_item_code ?? ""),
      fee_item_name: String(item?.fee_item_name ?? ""),
      category_id: String(item?.category_id ?? ""),
      category_code: String(item?.category_code ?? ""),
      category_name: String(item?.category_name ?? ""),
    }));
  }

  return NextResponse.json({
    policy:
      policyRaw && typeof policyRaw === "object" && !Array.isArray(policyRaw)
        ? policyRaw
        : null,
    fee_categories: Array.isArray(categoriesRaw) ? categoriesRaw : [],
    fee_items: Array.isArray(itemsRaw) ? itemsRaw : [],
    fee_structures,
    fee_structure_items,
    scholarships: Array.isArray(scholarshipsRaw) ? scholarshipsRaw : [],
  });
}
