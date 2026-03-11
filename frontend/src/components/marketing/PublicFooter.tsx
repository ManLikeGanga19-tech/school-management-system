import { School, ShieldCheck } from "lucide-react";

export function PublicFooter({ adminHost = "admin.shulehq.co.ke" }: { adminHost?: string }) {
  return (
    <footer className="relative border-t border-slate-200 bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.85fr))]">
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-slate-950">
                <School className="size-5" />
              </div>
              <div>
                <p className="text-lg font-semibold text-white">ShuleHQ</p>
                <p className="text-sm text-slate-400">Enterprise school operations delivery</p>
              </div>
            </div>
            <p className="max-w-md text-sm leading-7 text-slate-400">
              Public onboarding, SaaS administration, and school workspaces are intentionally separated so rollout stays controlled and operational traffic stays where it belongs.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Navigation</p>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li><a href="/#engage" className="transition hover:text-white">Request desk</a></li>
              <li><a href="/#platform" className="transition hover:text-white">Platform</a></li>
              <li><a href="/#security" className="transition hover:text-white">Security</a></li>
              <li><a href="/#rollout" className="transition hover:text-white">Rollout</a></li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Operating posture</p>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-300">
              <li>Host-separated public, admin, and tenant routing</li>
              <li>SaaS control plane on <span className="font-medium text-white">{adminHost}</span></li>
              <li>Request-led rollout before live workspace access</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ShuleHQ. Public onboarding and tenant operations are served through separate hosts by design.</p>
          <div className="flex items-center gap-2 text-slate-400">
            <ShieldCheck className="size-3.5" />
            HTTPS edge, loopback-only internal services, controlled rollout intake.
          </div>
        </div>
      </div>
    </footer>
  );
}
