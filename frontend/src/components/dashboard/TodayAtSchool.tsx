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
      <div className="dashboard-surface rounded-[1.6rem] p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
          <CalendarX2 className="h-4 w-4" /> Today at School
        </div>
        <p className="mt-2 text-sm text-slate-400">
          School calendar info unavailable right now.
        </p>
      </div>
    );
  }

  const term = data.current_term;
  const events = data.today_events ?? [];

  return (
    <div className="dashboard-surface rounded-[1.6rem] p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarHeart className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Today at School</h3>
        </div>
        <p className="text-xs text-slate-500">{fmtToday(data.today)}</p>
      </div>

      {/* ── Current term block ───────────────────────────────────────── */}
      {term ? (
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold text-slate-800">{term.name}</p>
              <span className="rounded-full bg-white px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500 ring-1 ring-slate-200">
                {term.code}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {fmtDate(term.start_date)} → {fmtDate(term.end_date)}
            </p>
          </div>

          {term.total_days > 0 && (
            <>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, term.progress_pct))}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                <span>
                  Day <strong className="text-slate-700">{term.days_into_term}</strong> of {term.total_days}
                </span>
                <span>
                  <strong className="text-slate-700">{term.days_remaining}</strong> day{term.days_remaining === 1 ? "" : "s"} remaining
                  {" · "}
                  {term.progress_pct}%
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-400">
          No academic term configured yet. Set one up under School Setup → Terms.
        </div>
      )}

      {/* ── Today's events ──────────────────────────────────────────── */}
      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <CalendarDays className="h-3.5 w-3.5" /> Today's activity
          {events.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {events.length}
            </span>
          )}
        </div>
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 py-3 text-xs text-slate-400">
            No special events on the calendar for today. Regular school day.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => {
              const tone = eventTone(ev);
              const Icon = tone.icon;
              const time = [fmtTime(ev.start_time), fmtTime(ev.end_time)]
                .filter(Boolean)
                .join(" – ");
              const badge =
                ev.starts_today
                  ? "Starts today"
                  : ev.ends_today
                    ? "Ends today"
                    : ev.day_index && ev.day_total
                      ? `Day ${ev.day_index} of ${ev.day_total}`
                      : null;
              return (
                <li
                  key={`${ev.source}-${ev.id}`}
                  className={`flex items-start gap-3 rounded-xl border ${tone.border} ${tone.bg} px-3 py-2`}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className={`text-sm font-semibold ${tone.text}`}>
                        {ev.title}
                      </p>
                      <span className="text-[10px] uppercase tracking-wide text-slate-500">
                        {tone.label}
                      </span>
                      {badge && (
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                          {badge}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      <span>
                        {fmtDate(ev.start_date)}
                        {ev.end_date && ev.end_date !== ev.start_date && (
                          <> → {fmtDate(ev.end_date)}</>
                        )}
                      </span>
                      {time && (
                        <span className="text-slate-500">· {time}</span>
                      )}
                      {ev.location && (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <MapPin className="h-3 w-3" /> {ev.location}
                        </span>
                      )}
                    </p>
                    {ev.notes && (
                      <p className="mt-0.5 text-[11px] italic text-slate-500">
                        {ev.notes}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
