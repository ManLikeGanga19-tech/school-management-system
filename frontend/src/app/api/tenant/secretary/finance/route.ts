import { NextResponse } from "next/server";
import { backendFetch } from "@/server/backend/client";

type FinanceAction =
  | "create_invoice"
  | "generate_fees_invoice"
  | "record_payment"
  | "update_policy"
  | "create_fee_category"
  | "create_fee_item"
  | "create_fee_structure"
  | "update_fee_structure"
  | "delete_fee_structure"
  | "add_structure_item"
  | "remove_structure_item"
  | "upsert_structure_items"
  | "create_scholarship";

function readError(body: any, fallback: string) {
  if (!body) return fallback;
  if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  if (typeof body.message === "string" && body.message.trim()) return body.message;
  return fallback;
}

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

  const [
    policyRes,
    invoicesRes,
    categoriesRes,
    itemsRes,
    structuresRes,
    scholarshipsRes,
    enrollmentsRes,
    paymentsRes,
  ] = await Promise.all([
    safeFetch("/api/v1/finance/policy"),
    safeFetch("/api/v1/finance/invoices"),
    safeFetch("/api/v1/finance/fee-categories"),
    safeFetch("/api/v1/finance/fee-items"),
    safeFetch("/api/v1/finance/fee-structures"),
    safeFetch("/api/v1/finance/scholarships"),
    safeFetch("/api/v1/enrollments/"),
    safeFetch("/api/v1/finance/payments"),
  ]);

  const [
    policyRaw,
    invoicesRaw,
    categoriesRaw,
    itemsRaw,
    structuresRaw,
    scholarshipsRaw,
    enrollmentsRaw,
    paymentsRaw,
  ] = await Promise.all([
    policyRes.json().catch(() => null),
    invoicesRes.json().catch(() => []),
    categoriesRes.json().catch(() => []),
    itemsRes.json().catch(() => []),
    structuresRes.json().catch(() => []),
    scholarshipsRes.json().catch(() => []),
    enrollmentsRes.json().catch(() => []),
    paymentsRes.json().catch(() => []),
  ]);

  const policy = asObject(policyRaw);
  const invoices = asList(invoicesRaw);
  const fee_categories = asList(categoriesRaw);
  const fee_items = asList(itemsRaw);
  const fee_structures = asList(structuresRaw);
  const scholarships = asList(scholarshipsRaw);
  const enrollments = asList(enrollmentsRaw);
  const payments = asList(paymentsRaw);

  const structureDetails = await Promise.all(
    fee_structures.map(async (structure: any) => {
      const id = String(structure?.id || "").trim();
      if (!id) return null;
      const detailRes = await safeFetch(`/api/v1/finance/fee-structures/${encodeURIComponent(id)}`);
      const detail = await detailRes.json().catch(() => null);
      return {
        id,
        ok: detailRes.ok,
        detail,
      };
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

  structureDetails.forEach((entry) => {
    if (!entry || !entry.ok || !entry.detail) return;
    const items = Array.isArray((entry.detail as any)?.items)
      ? (entry.detail as any).items
      : [];
    fee_structure_items[entry.id] = items.map((item: any) => ({
      fee_item_id: String(item?.fee_item_id || ""),
      amount: item?.amount ?? 0,
      fee_item_code: String(item?.fee_item_code || ""),
      fee_item_name: String(item?.fee_item_name || ""),
      category_id: String(item?.category_id || ""),
      category_code: String(item?.category_code || ""),
      category_name: String(item?.category_name || ""),
    }));
  });

  return NextResponse.json(
    {
      policy,
      invoices,
      fee_categories,
      fee_items,
      fee_structures,
      fee_structure_items,
      scholarships,
      enrollments,
      payments,
      health: {
        policy: policyRes.ok,
        invoices: invoicesRes.ok,
        fee_categories: categoriesRes.ok,
        fee_items: itemsRes.ok,
        fee_structures: structuresRes.ok,
        fee_structure_items: structureDetails.every((x) => (x ? x.ok : true)),
        scholarships: scholarshipsRes.ok,
        enrollments: enrollmentsRes.ok,
        payments: paymentsRes.ok,
      },
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim() as FinanceAction;
  const payload = body?.payload ?? {};

  let path = "";
  let method: "POST" | "PUT" | "DELETE" = "POST";
  let backendBody: unknown = payload;

  switch (action) {
    case "create_invoice":
      path = "/api/v1/finance/invoices";
      break;
    case "generate_fees_invoice":
      path = "/api/v1/finance/invoices/generate/fees";
      break;
    case "record_payment":
      path = "/api/v1/finance/payments";
      break;
    case "update_policy":
      path = "/api/v1/finance/policy";
      method = "PUT";
      break;
    case "create_fee_category":
      path = "/api/v1/finance/fee-categories";
      break;
    case "create_fee_item":
      path = "/api/v1/finance/fee-items";
      break;
    case "create_fee_structure":
      path = "/api/v1/finance/fee-structures";
      break;
    case "update_fee_structure": {
      const structureId = String((payload as any)?.structure_id || "").trim();
      const updates = (payload as any)?.updates ?? null;
      if (!structureId || !updates || typeof updates !== "object") {
        return NextResponse.json(
          { detail: "structure_id and updates payload are required" },
          { status: 400 }
        );
      }
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(structureId)}`;
      method = "PUT";
      backendBody = updates;
      break;
    }
    case "delete_fee_structure": {
      const structureId = String((payload as any)?.structure_id || "").trim();
      if (!structureId) {
        return NextResponse.json({ detail: "structure_id is required" }, { status: 400 });
      }
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(structureId)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }
    case "add_structure_item": {
      const structureId = String((payload as any)?.structure_id || "").trim();
      const itemPayload = (payload as any)?.item ?? null;
      if (!structureId || !itemPayload || typeof itemPayload !== "object") {
        return NextResponse.json(
          { detail: "structure_id and item payload are required" },
          { status: 400 }
        );
      }
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(structureId)}/items`;
      backendBody = itemPayload;
      break;
    }
    case "remove_structure_item": {
      const structureId = String((payload as any)?.structure_id || "").trim();
      const feeItemId = String((payload as any)?.fee_item_id || "").trim();
      if (!structureId || !feeItemId) {
        return NextResponse.json(
          { detail: "structure_id and fee_item_id are required" },
          { status: 400 }
        );
      }
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(
        structureId
      )}/items/${encodeURIComponent(feeItemId)}`;
      method = "DELETE";
      backendBody = undefined;
      break;
    }
    case "upsert_structure_items": {
      const structureId = String((payload as any)?.structure_id || "").trim();
      const items = Array.isArray((payload as any)?.items) ? (payload as any).items : [];
      if (!structureId) {
        return NextResponse.json({ detail: "structure_id is required" }, { status: 400 });
      }
      path = `/api/v1/finance/fee-structures/${encodeURIComponent(structureId)}/items`;
      method = "PUT";
      backendBody = items;
      break;
    }
    case "create_scholarship":
      path = "/api/v1/finance/scholarships";
      break;
    default:
      return NextResponse.json(
        {
          detail:
            "Invalid action. Use create_invoice|generate_fees_invoice|record_payment|update_policy|create_fee_category|create_fee_item|create_fee_structure|update_fee_structure|delete_fee_structure|add_structure_item|remove_structure_item|upsert_structure_items|create_scholarship",
        },
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
