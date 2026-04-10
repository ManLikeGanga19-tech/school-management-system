import { Suspense } from "react";
import { IgcseModulePage } from "@/components/igcse/IgcseModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryIgcsePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading IGCSE…</div>
        </div>
      }
    >
      <IgcseModulePage title="Secretary" nav={secretaryNav} canManageSubjects={false} />
    </Suspense>
  );
}
