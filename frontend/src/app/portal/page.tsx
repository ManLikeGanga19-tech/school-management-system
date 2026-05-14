"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GraduationCap, ShieldCheck, AlertCircle, Loader2, BookOpen, Receipt } from "lucide-react";

interface Grade {
  subject: string;
  strand?: string;
  sub_strand?: string;
  grade?: string;
  comments?: string;
}

interface Child {
  enrollment_id: string;
  student_name: string;
  admission_number?: string;
  class_code: string;
  class_name?: string;
  relationship: string;
  outstanding: string;
  grades: Grade[];
}

interface PortalData {
  parent_id: string;
  parent_name: string;
  school_name: string;
  school_slug: string;
  children: Child[];
}

function GradesTab({ grades }: { grades: Grade[] }) {
  if (grades.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No assessment records for the current term.</p>;
  }

  const bySubject: Record<string, Grade[]> = {};
  for (const g of grades) {
    if (!bySubject[g.subject]) bySubject[g.subject] = [];
    bySubject[g.subject].push(g);
  }

  const gradeColor = (g?: string) => {
    if (!g) return "bg-gray-100 text-gray-500";
    const upper = g.toUpperCase();
    if (upper === "EE") return "bg-emerald-100 text-emerald-700";
    if (upper === "ME") return "bg-blue-100 text-blue-700";
    if (upper === "AE") return "bg-amber-100 text-amber-700";
    if (upper === "BE") return "bg-red-100 text-red-700";
    return "bg-gray-100 text-gray-600";
  };

  return (
    <div className="space-y-6">
      {Object.entries(bySubject).map(([subject, rows]) => (
        <div key={subject}>
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">{subject}</h4>
          <div className="space-y-2">
            {rows.map((g, i) => (
              <div key={i} className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3">
                <span className={`mt-0.5 px-2 py-0.5 rounded-lg text-xs font-bold min-w-[36px] text-center ${gradeColor(g.grade)}`}>
                  {g.grade ?? "–"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{g.sub_strand ?? g.strand ?? subject}</p>
                  {g.comments && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{g.comments}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChildCard({ child }: { child: Child }) {
  const [tab, setTab] = useState<"grades" | "fees">("grades");
  const hasOutstanding = parseFloat(child.outstanding) > 0;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900 tracking-tight">{child.student_name}</h3>
            <p className="text-sm text-gray-400 font-medium mt-0.5">
              {child.class_name || child.class_code}
              {child.admission_number && ` · ${child.admission_number}`}
            </p>
          </div>
          {hasOutstanding && (
            <div className="shrink-0 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-red-400">Balance</p>
              <p className="text-sm font-bold text-red-600">KES {Number(child.outstanding).toLocaleString()}</p>
            </div>
          )}
          {!hasOutstanding && (
            <div className="shrink-0 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-1.5 text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Fees</p>
              <p className="text-sm font-bold text-emerald-600">Cleared</p>
            </div>
          )}
        </div>

        <div className="flex gap-1 mt-4">
          {(["grades", "fees"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                tab === t ? "bg-brand-primary text-white" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {t === "grades" ? <BookOpen className="w-3 h-3" /> : <Receipt className="w-3 h-3" />}
              {t === "grades" ? "Report" : "Fees"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 py-5">
        {tab === "grades" && <GradesTab grades={child.grades} />}
        {tab === "fees" && (
          <div className="py-4 text-center">
            {hasOutstanding ? (
              <div className="space-y-2">
                <p className="text-3xl font-bold text-red-600">KES {Number(child.outstanding).toLocaleString()}</p>
                <p className="text-sm text-gray-400">Outstanding balance — please contact the school to make a payment.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl font-bold text-emerald-600">All Paid</p>
                <p className="text-sm text-gray-400">No outstanding fees for this term.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ParentPortalPage() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const slug = params.get("slug") ?? "";

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !slug) {
      setError("Invalid portal link. Please request a new link from the school.");
      setLoading(false);
      return;
    }

    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1";
    fetch(`${base}/public/portal?token=${encodeURIComponent(token)}&slug=${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { detail?: string }).detail ?? "This link is invalid or has expired.");
        }
        return res.json() as Promise<PortalData>;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, [token, slug]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-primary rounded-lg flex items-center justify-center text-white shadow-sm">
            <ShieldCheck size={16} />
          </div>
          <div>
            <span className="font-bold text-gray-900 text-sm tracking-tight">
              {data?.school_name ?? "ShuleHQ"}
            </span>
            <span className="text-gray-400 text-xs ml-2 font-medium">Parent Portal</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <Loader2 className="w-8 h-8 text-brand-primary animate-spin" />
            <p className="text-sm text-gray-400 font-medium">Loading your children's records…</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <p className="font-bold text-gray-800 mb-1">Unable to load portal</p>
              <p className="text-sm text-gray-400 max-w-xs leading-relaxed">{error}</p>
            </div>
            <p className="text-xs text-gray-300 mt-4">Contact the school office for a new link.</p>
          </div>
        )}

        {data && !loading && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Welcome</p>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{data.parent_name}</h1>
              <p className="text-sm text-gray-400 mt-1">
                {data.children.length === 1
                  ? "Showing records for 1 child."
                  : `Showing records for ${data.children.length} children.`}
              </p>
            </div>

            {data.children.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <GraduationCap className="w-10 h-10 text-gray-200" />
                <p className="text-sm text-gray-400">No students linked to this account yet.</p>
              </div>
            )}

            {data.children.map((child) => (
              <ChildCard key={child.enrollment_id} child={child} />
            ))}

            <p className="text-center text-[10px] text-gray-300 font-bold uppercase tracking-widest pt-4">
              Powered by ShuleHQ · For help contact {data.school_name}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
