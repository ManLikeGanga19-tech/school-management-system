/**
 * Lightweight finance setup BFF — returns only catalogue data (no invoices, payments,
 * or enrollments).  Used by the dedicated Fee Structures, Categories and Scholarships
 * pages so they don't have to pull the full finance payload.
 *
 * POST to this route proxies write actions (same action format as the full route).
 */
import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

type FinanceAction =
  | "create_fee_category"
  | "update_fee_category"
  | "delete_fee_category"
  | "create_fee_item"
  | "update_fee_item"
  | "delete_fee_item"
  | "create_fee_structure"
  | "update_fee_structure"
  | "delete_fee_structure"
  | "add_structure_item"
  | "remove_structure_item"
  | "create_scholarship"
  | "update_scholarship"
  | "delete_scholarship";

function readError(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === "string" && b.detail.trim()) return b.detail;
  if (typeof b.message === "string" && b.message.trim()) return b.message;
  return fallback;
}

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
  const [categoriesRes, itemsRes, structuresRes, scholarshipsRes] =
    await Promise.all([
      safeFetch("/api/v1/finance/fee-categories"),
      safeFetch("/api/v1/finance/fee-items"),
      safeFetch("/api/v1/finance/fee-structures"),
      safeFetch("/api/v1/finance/scholarships"),
    ]);

  const [categoriesRaw, itemsRaw, structuresRaw, scholarshipsRaw] =
    await Promise.all([
      categoriesRes.json().catch(() => []),
      itemsRes.json().catch(() => []),
      structuresRes.json().catch(() => []),
      scholarshipsRes.json().catch(() => []),
    ]);

  const fee_structures: unknown[] = Array.isArray(structuresRaw)
    ? structuresRaw
    : [];

  // Fetch structure items for every structure in parallel
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
    const items = Array.isArray((entry.detail as Record<string, unknown>).items)
      ? ((entry.detail as Record<string, unknown>).items as Record<
          string,
          unknown
        >[])
      : [];
    fee_structure_items[entry.id] = items.map((item) => ({
      fee_item_id: String(item?.fee_item_id ?? ""),
      amount: (item?.amount as string | number) ?? 0,
      fee_item_code: String(item?.fee_item_code ?? ""),
      fee_item_name: String(item?.fee_item_name ?? ""),
      category_id: String(item?.category_id ?? ""),
      category_code: String(item?.category_code ?? ""),
      category_name: String(item?.category_name ?? ""),
    }));
  }

  return NextResponse.json({
    fee_categories: Array.isArray(categoriesRaw) ? categoriesRaw : [],
    fee_items: Array.isArray(itemsRaw) ? itemsRaw : [],
    fee_structures,
    fee_structure_items,
    scholarships: Array.isArray(scholarshipsRaw) ? scholarshipsRaw : [],
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body?.action ?? "").trim() as FinanceAction;
  const payload = (body?.payload ?? {}) as Record<string, unknown>;

  let path = "";
  let method: "POST" | "PUT" | "DELETE" = "POST";
  let backendBody: unknown = payload;

  switch (action) {
    // ── Categories ──────────────────────────────────────────────────────────
    case "create_fee_category":
      path = "/api/v1/finance/fee-categories";
      break;
    case "update_fee_category": {
      const id = String(payload?.category_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "category_id required" }, { status: 400 });
      path = `/api/v1/finance/fee-categories/${encodeURIComponent(id)}`;
      method = "PUT";
      backendBody = payload?.updates ?? payload;
      break;
    }
    case "delete_fee_category": {
      const id = String(payload?.category_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "category_id required" }, { status: 400 });
      path = `/api/v1/finance/fee-categories/${encodeURIComponent(id)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }

    // ── Items ────────────────────────────────────────────────────────────────
    case "create_fee_item":
      path = "/api/v1/finance/fee-items";
      break;
    case "update_fee_item": {
      const id = String(payload?.item_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "item_id required" }, { status: 400 });
      path = `/api/v1/finance/fee-items/${encodeURIComponent(id)}`;
      method = "PUT";
      backendBody = payload?.updates ?? payload;
      break;
    }
    case "delete_fee_item": {
      const id = String(payload?.item_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "item_id required" }, { status: 400 });
      path = `/api/v1/finance/fee-items/${encodeURIComponent(id)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }

    // ── Structures ───────────────────────────────────────────────────────────
    case "create_fee_structure":
      path = "/api/v1/finance/fee-structures";
      break;
    case "update_fee_structure": {
      const sid = String(payload?.structure_id ?? "").trim();
      const updates = payload?.updates ?? null;
      if (!sid || !updates)
        return NextResponse.json(
          { detail: "structure_id and updates required" },
          { status: 400 }
        );
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(sid)}`;
      method = "PUT";
      backendBody = updates;
      break;
    }
    case "delete_fee_structure": {
      const sid = String(payload?.structure_id ?? "").trim();
      if (!sid)
        return NextResponse.json({ detail: "structure_id required" }, { status: 400 });
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(sid)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }
    case "add_structure_item": {
      const sid = String(payload?.structure_id ?? "").trim();
      const item = payload?.item ?? null;
      if (!sid || !item)
        return NextResponse.json(
          { detail: "structure_id and item required" },
          { status: 400 }
        );
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(sid)}/items`;
      backendBody = item;
      break;
    }
    case "remove_structure_item": {
      const sid = String(payload?.structure_id ?? "").trim();
      const fid = String(payload?.fee_item_id ?? "").trim();
      if (!sid || !fid)
        return NextResponse.json(
          { detail: "structure_id and fee_item_id required" },
          { status: 400 }
        );
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(sid)}/items/${encodeURIComponent(fid)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }

    // ── Scholarships ─────────────────────────────────────────────────────────
    case "create_scholarship":
      path = "/api/v1/finance/scholarships";
      break;
    case "update_scholarship": {
      const id = String(payload?.scholarship_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "scholarship_id required" }, { status: 400 });
      path = `/api/v1/finance/scholarships/${encodeURIComponent(id)}`;
      method = "PUT";
      backendBody = payload?.updates ?? payload;
      break;
    }
    case "delete_scholarship": {
      const id = String(payload?.scholarship_id ?? "").trim();
      if (!id)
        return NextResponse.json({ detail: "scholarship_id required" }, { status: 400 });
      path = `/api/v1/finance/scholarships/${encodeURIComponent(id)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }

    default:
      return NextResponse.json(
        { detail: `Unknown setup action: ${action}` },
        { status: 400 }
      );
  }

  const res = await backendFetch(path, {
    method,
    body: backendBody === undefined ? undefined : JSON.stringify(backendBody),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { detail: readError(data, "Finance action failed") },
      { status: res.status }
    );
  }
  return NextResponse.json({ ok: true, data }, { status: 200 });
}
