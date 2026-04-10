import { Suspense } from "react";
import { DisciplineModulePage } from "@/components/discipline/DisciplineModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryDisciplinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading Discipline…</div>
        </div>
      }
    >
      <DisciplineModulePage title="Secretary" nav={secretaryNav} canManage={true} canResolve={false} />
    </Suspense>
  );
}
