import { Suspense } from "react";
import { CbcModulePage } from "@/components/cbc/CbcModulePage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorCbcPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading CBC…</div>
        </div>
      }
    >
      <CbcModulePage title="Director" nav={directorNav} canManageCurriculum={true} />
    </Suspense>
  );
}
