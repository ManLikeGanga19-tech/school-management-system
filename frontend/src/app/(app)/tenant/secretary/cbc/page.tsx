import { Suspense } from "react";
import { CbcModulePage } from "@/components/cbc/CbcModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryCbcPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center text-sm text-slate-500">Loading CBC…</div>
        </div>
      }
    >
      <CbcModulePage title="Secretary" nav={secretaryNav} canManageCurriculum={true} />
    </Suspense>
  );
}
