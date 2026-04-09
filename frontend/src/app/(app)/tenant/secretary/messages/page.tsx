import { Suspense } from "react";
import SmsModulePage from "@/components/sms/SmsModulePage";
import { secretaryNav } from "@/components/layout/nav-config";

export default function SecretaryMessagesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>}>
      <SmsModulePage title="Secretary" nav={secretaryNav} canTopup={false} />
    </Suspense>
  );
}
