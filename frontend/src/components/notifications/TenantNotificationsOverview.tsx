import { BellRing } from "lucide-react";

import type { TenantNotificationPreview } from "@/lib/tenant-notifications";

type TenantNotificationsOverviewProps = {
  notifications: TenantNotificationPreview[];
  unreadCount: number;
  totalCount: number;
  viewAllHref: string;
  subtitle?: string;
  maxItems?: number;
};

function timeAgo(dateString: string) {
  const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000);
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function TenantNotificationsOverview({
  notifications,
  unreadCount,
  totalCount,
  viewAllHref,
  subtitle = "Latest tenant notifications requiring attention",
  maxItems = 2,
}: TenantNotificationsOverviewProps) {
  const latest = Array.isArray(notifications) ? notifications.slice(0, maxItems) : [];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-slate-400" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Notifications Overview</h2>
            <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-blue-200">
            {unreadCount} unread
          </span>
          <a
            href={viewAllHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
          >
            View all
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          </a>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {latest.length > 0 ? (
          <div className="space-y-2">
            {latest.map((item) => (
              <a
                key={item.id}
                href={viewAllHref}
                className={`block rounded-xl border px-3 py-2 transition ${
                  item.unread
                    ? "border-blue-100 bg-blue-50/60 hover:bg-blue-50"
                    : "border-slate-100 bg-slate-50 hover:bg-slate-100"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{item.message}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">{timeAgo(item.created_at)}</span>
                    {item.unread && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        Unread
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No notifications available right now.
          </div>
        )}
      </div>
    </div>
  );
}

