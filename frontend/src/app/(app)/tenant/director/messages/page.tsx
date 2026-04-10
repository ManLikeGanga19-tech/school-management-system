import { Suspense } from "react";
import SmsModulePage from "@/components/sms/SmsModulePage";
import { directorNav } from "@/components/layout/nav-config";

export default function DirectorMessagesPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>}>
      <SmsModulePage title="Director" nav={directorNav} canTopup={true} />
    </Suspense>
  );
}
