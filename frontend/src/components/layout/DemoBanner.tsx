/**
 * DemoBanner — a calm, persistent notice shown ONLY inside the read-only demo
 * tenant. It exists so a prospect always knows changes won't save, instead of
 * discovering it by hitting a 403 that looks like a bug.
 *
 * Rendered by AppShell exclusively behind an `is_demo` gate, so for every real
 * (paying) tenant this component is never mounted at all.
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="w-full bg-amber-brown/10 border-b border-amber-brown/25 px-4 py-2 text-center text-sm font-medium text-amber-brown"
    >
      You&apos;re exploring a <strong>read-only demo</strong> of ShuleHQ — click
      through every module freely. Changes aren&apos;t saved.{" "}
      <a href="/demo" className="underline underline-offset-2 hover:opacity-80">
        Get started for your school →
      </a>
    </div>
  );
}
