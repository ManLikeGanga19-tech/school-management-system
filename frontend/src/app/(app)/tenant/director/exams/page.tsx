import { Suspense } from "react";
import { ExamsModulePage } from "@/components/exams/ExamsModulePage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorExamsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading exams…</div>
        </div>
      }
    >
      <ExamsModulePage appTitle="Director" nav={directorNav} />
    </Suspense>
  );
}
