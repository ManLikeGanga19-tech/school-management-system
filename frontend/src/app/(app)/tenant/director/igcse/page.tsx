import { Suspense } from "react";
import { IgcseModulePage } from "@/components/igcse/IgcseModulePage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorIgcsePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading IGCSE…</div>
        </div>
      }
    >
      <IgcseModulePage title="Director" nav={directorNav} canManageSubjects={true} />
    </Suspense>
  );
}
