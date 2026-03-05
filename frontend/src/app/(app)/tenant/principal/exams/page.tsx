import { Suspense } from "react";
import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { principalNav } from "@/components/layout/nav-config";

export default function PrincipalExamsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading exams…</div>
        </div>
      }
    >
      <ExamsModulePage appTitle="Principal" nav={principalNav} />
    </Suspense>
  );
}
