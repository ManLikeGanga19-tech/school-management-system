"use client";

/**
 * TodayAtSchool
 *
 * Dashboard card that shows the current academic term (with date range +
 * progress bar) and every event happening today (school-calendar +
 * general /events module). Backed by the today_at_school block returned by
 * both /director/kpis and /tenants/secretary/dashboard.
 */

import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarHeart,
  CalendarX2,
  MapPin,
  PartyPopper,
  Sun,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

export type TodayEvent = {
  source: "CALENDAR" | "EVENT";
  id: string;
  type: string;        // CALENDAR: HALF_TERM_BREAK|EXAM_WINDOW; EVENT: 'EVENT'
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  notes?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
  term_code?: string | null;
  academic_year?: number | null;
  target_scope?: string | null;
  starts_today?: boolean;
  ends_today?: boolean;
  day_index?: number | null;
  day_total?: number | null;
};

export type TodayAtSchoolData = {
  today: string;
  current_term: {
    id: string;
    name: string;
    code: string;
    start_date?: string | null;
    end_date?: string | null;
    days_into_term: number;
    days_remaining: number;
    progress_pct: number;
    total_days: number;
  } | null;
  today_events: TodayEvent[];
};

type Props = {
  data: TodayAtSchoolData | null | undefined;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtToday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-KE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function fmtTime(t: string | null | undefined): string | null {
  if (!t) return null;
  // Strip seconds if "HH:MM:SS"
  return /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : t;
}

function eventTone(ev: TodayEvent): {
  bg: string; border: string; text: string; icon: typeof CalendarCheck;
  label: string;
} {
  if (ev.source === "CALENDAR" && ev.type === "EXAM_WINDOW") {
    return {
      bg: "bg-amber-50", border: "border-amber-200",
      text: "text-amber-900", icon: CalendarClock, label: "Exam window",
    };
  }
  if (ev.source === "CALENDAR" && ev.type === "HALF_TERM_BREAK") {
    return {
      bg: "bg-sky-50", border: "border-sky-200",
      text: "text-sky-900", icon: Sun, label: "Half-term break",
    };
  }
  // General event.
  return {
    bg: "bg-violet-50", border: "border-violet-200",
    text: "text-violet-900", icon: PartyPopper, label: "Event",
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function TodayAtSchool({ data }: Props) {
  if (!data) {
    return (
      <div className="dashboard-surface flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-[var(--tenant-muted)]">
        <CalendarX2 className="h-4 w-4" /> School calendar info unavailable right now.
      </div>
    );
  }

  const term = data.current_term;
  const events = data.today_events ?? [];
  const pct = term ? Math.min(100, Math.max(0, term.progress_pct)) : 0;

  return (
    <div className="dashboard-surface rounded-xl px-4 py-3">
      {/* Slim single-row strip: date + term · progress · today's activity */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
        {/* Date + term */}
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--tenant-primary-soft)] text-[var(--tenant-primary)]">
            <CalendarHeart className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-[var(--tenant-ink)]">
                {term ? term.name : "No active term"}
              </span>
              {term && (
                <span className="shrink-0 rounded bg-[var(--tenant-surface-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--tenant-muted)]">
                  {term.code}
                </span>
              )}
            </div>
            <div className="truncate text-xs text-[var(--tenant-muted)]">
              {fmtToday(data.today)}
              {term ? ` · ${fmtDate(term.start_date)} → ${fmtDate(term.end_date)}` : ""}
            </div>
          </div>
        </div>

        {/* Term progress */}
        {term && term.total_days > 0 && (
          <div className="min-w-0 flex-1 lg:max-w-xs">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--tenant-surface-2)]">
              <div className="h-full rounded-full bg-[var(--tenant-primary)] transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-[var(--tenant-muted)]">
              <span>Day <strong className="text-[var(--tenant-ink)]">{term.days_into_term}</strong> / {term.total_days}</span>
              <span><strong className="text-[var(--tenant-ink)]">{term.days_remaining}</strong> left · {term.progress_pct}%</span>
            </div>
          </div>
        )}

        {/* Today's activity summary */}
        <div className="shrink-0 lg:ml-auto">
          {events.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tenant-surface-2)] px-3 py-1 text-xs font-medium text-[var(--tenant-muted)]">
              <CalendarDays className="h-3.5 w-3.5" /> Regular school day
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tenant-primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--tenant-primary)]">
              <CalendarDays className="h-3.5 w-3.5" /> {events.length} event{events.length === 1 ? "" : "s"} today
            </span>
          )}
        </div>
      </div>

      {/* Event detail — only when there is something on today */}
      {events.length > 0 && (
        <ul className="mt-3 grid gap-2 border-t border-[var(--tenant-border)] pt-3 sm:grid-cols-2">
          {events.map((ev) => {
            const tone = eventTone(ev);
            const Icon = tone.icon;
            const time = [fmtTime(ev.start_time), fmtTime(ev.end_time)].filter(Boolean).join(" – ");
            const badge = ev.starts_today
              ? "Starts today"
              : ev.ends_today
                ? "Ends today"
                : ev.day_index && ev.day_total
                  ? `Day ${ev.day_index}/${ev.day_total}`
                  : null;
            return (
              <li key={`${ev.source}-${ev.id}`} className={`flex items-center gap-2.5 rounded-lg border ${tone.border} ${tone.bg} px-3 py-2`}>
                <Icon className={`h-4 w-4 shrink-0 ${tone.text}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-sm font-semibold ${tone.text}`}>{ev.title}</p>
                    {badge && (
                      <span className="shrink-0 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {badge}
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-2 truncate text-[11px] text-slate-600">
                    <span className="uppercase tracking-wide">{tone.label}</span>
                    {time && <span>· {time}</span>}
                    {ev.location && (
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {ev.location}</span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
