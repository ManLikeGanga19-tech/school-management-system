import { Suspense } from "react";
import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryExamsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading exams…</div>
        </div>
      }
    >
      <ExamsModulePage appTitle="Secretary" nav={secretaryNav} />
    </Suspense>
  );
}
