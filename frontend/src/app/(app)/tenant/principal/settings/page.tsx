import { AppShell } from "@/components/layout/AppShell";
import { principalNav } from "@/components/layout/nav-config";

export default function PrincipalSettingsRoute() {
  return (
    <AppShell title="Principal" nav={principalNav} activeHref="/tenant/principal/settings">
      <div className="space-y-5">
        <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-700 to-blue-500 p-6 text-white shadow-sm">
          <h1 className="text-2xl font-bold">Principal Settings</h1>
          <p className="mt-1 text-sm text-blue-100">
            Personal and tenant-wide security settings are managed by the director role.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Access Scope</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This account is configured for academic operations. If you need password reset,
            branding updates, or broader tenant security changes, request a director action.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
