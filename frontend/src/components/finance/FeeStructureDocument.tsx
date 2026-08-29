"use client";

/**
 * FeeStructureDocument — renders a fee structure exactly as it prints on the
 * school's document format (badge + letterhead + per-term fee table + footer),
 * driven by the tenant's print profile. Used as the live preview inside the
 * fee-structure editor modal so a director sees the real document while editing.
 *
 * It is a plain black-on-white "paper" — deliberately NOT tenant-themed, because
 * it mimics a printed document, not an app screen.
 */

export type FeeDocItem = {
  fee_item_id: string;
  fee_item_name: string;
  category_name?: string | null;
  charge_frequency: string;
  term_1_amount: number | string;
  term_2_amount: number | string;
  term_3_amount: number | string;
};

export type FeeDocProfile = {
  logo_url?: string | null;
  school_header?: string | null;
  receipt_footer?: string | null;
  currency?: string | null;
  po_box?: string | null;
  physical_address?: string | null;
  phone?: string | null;
  email?: string | null;
  school_motto?: string | null;
  authorized_signatory_name?: string | null;
  authorized_signatory_title?: string | null;
};

export type FeeDocStructure = {
  name: string;
  class_code: string;
  academic_year: number;
  student_type: string;
};

const n = (v: number | string) => (typeof v === "number" ? v : Number(v) || 0);

export function FeeStructureDocument({
  structure,
  items,
  profile,
  tenantSlug,
}: {
  structure: FeeDocStructure;
  items: FeeDocItem[];
  profile: FeeDocProfile;
  tenantSlug?: string | null;
}) {
  const cur = (profile.currency || "KES").toUpperCase();
  const money = (v: number) => `${cur} ${Math.round(v).toLocaleString("en-KE")}`;
  const perTerm = (it: FeeDocItem) => it.charge_frequency === "PER_TERM";
  const rowTotal = (it: FeeDocItem) =>
    perTerm(it) ? n(it.term_1_amount) + n(it.term_2_amount) + n(it.term_3_amount) : n(it.term_1_amount);

  const t1 = items.reduce((s, i) => s + n(i.term_1_amount), 0);
  const t2 = items.reduce((s, i) => s + (perTerm(i) ? n(i.term_2_amount) : 0), 0);
  const t3 = items.reduce((s, i) => s + (perTerm(i) ? n(i.term_3_amount) : 0), 0);
  const grand = items.reduce((s, i) => s + rowTotal(i), 0);

  const schoolName = profile.school_header || "Your School";
  const contactBits = [
    profile.po_box ? `P.O. Box ${profile.po_box}` : null,
    profile.physical_address,
    profile.phone,
    profile.email,
  ].filter(Boolean);
  const badgeUrl = tenantSlug ? `/api/v1/public/tenant-badge?slug=${encodeURIComponent(tenantSlug)}` : null;

  return (
    <div className="mx-auto w-full max-w-[640px] bg-white p-8 text-[#1a1a1a] shadow-sm ring-1 ring-black/5" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
      {/* Letterhead */}
      <div className="flex items-center gap-4 border-b-2 border-[#1a1a1a] pb-4">
        {badgeUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeUrl} alt="" className="h-16 w-16 shrink-0 object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        )}
        <div className="min-w-0 flex-1 text-center">
          <div className="text-xl font-bold uppercase tracking-wide">{schoolName}</div>
          {contactBits.length > 0 && (
            <div className="mt-0.5 text-[11px] leading-tight text-[#444]">{contactBits.join(" · ")}</div>
          )}
          {profile.school_motto && (
            <div className="mt-1 text-[11px] italic text-[#666]">“{profile.school_motto}”</div>
          )}
        </div>
      </div>

      {/* Document title */}
      <div className="mt-5 text-center">
        <div className="inline-block border-b border-[#1a1a1a] px-3 pb-0.5 text-sm font-bold uppercase tracking-[0.15em]">
          Fee Structure
        </div>
        <div className="mt-2 text-[13px] text-[#333]">
          Class <b>{structure.class_code}</b> · Academic Year <b>{structure.academic_year}</b> · {structure.student_type.replace(/_/g, " ")}
        </div>
      </div>

      {/* Fee table */}
      <table className="mt-4 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y border-[#1a1a1a] text-left">
            <th className="py-1.5 pr-2 font-semibold">Fee Item</th>
            <th className="py-1.5 px-2 text-right font-semibold">Term 1</th>
            <th className="py-1.5 px-2 text-right font-semibold">Term 2</th>
            <th className="py-1.5 px-2 text-right font-semibold">Term 3</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={5} className="py-6 text-center text-[#888]">No fee items yet.</td></tr>
          ) : items.map((it) => (
            <tr key={it.fee_item_id} className="border-b border-[#e5e5e5]">
              <td className="py-1.5 pr-2">
                {it.fee_item_name}
                {!perTerm(it) && <span className="ml-1 text-[10px] uppercase text-[#999]">(once)</span>}
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums">{money(n(it.term_1_amount))}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{perTerm(it) ? money(n(it.term_2_amount)) : "—"}</td>
              <td className="py-1.5 px-2 text-right tabular-nums">{perTerm(it) ? money(n(it.term_3_amount)) : "—"}</td>
              <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money(rowTotal(it))}</td>
            </tr>
          ))}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-[#1a1a1a] font-bold">
              <td className="py-2 pr-2 uppercase">Total</td>
              <td className="py-2 px-2 text-right tabular-nums">{money(t1)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{money(t2)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{money(t3)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">{money(grand)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Footer */}
      <div className="mt-6 flex items-end justify-between gap-6">
        <div className="text-[11px] text-[#555]">
          {profile.receipt_footer && <p>{profile.receipt_footer}</p>}
        </div>
        {profile.authorized_signatory_name && (
          <div className="text-center">
            <div className="mb-1 h-8 border-b border-[#1a1a1a]" style={{ minWidth: 160 }} />
            <div className="text-[12px] font-semibold">{profile.authorized_signatory_name}</div>
            <div className="text-[10px] text-[#666]">{profile.authorized_signatory_title || "Authorized Signatory"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
