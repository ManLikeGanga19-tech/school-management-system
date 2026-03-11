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
    <div className="dashboard-surface overflow-hidden rounded-[1.75rem]">
      <div className="flex flex-col gap-3 border-b border-[#eadfce] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[#173f49]" />
          <div>
            <h2 className="text-sm font-semibold text-[#132129]">Notifications Overview</h2>
            <p className="mt-0.5 text-xs text-[#6c757d]">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[#c9dadd] bg-[#eff5f6] px-2.5 py-0.5 text-xs font-medium text-[#173f49]">
            {unreadCount} unread
          </span>
          <a
            href={viewAllHref}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#ddd0ba] px-3 py-1 text-xs font-medium text-[#57656f] transition hover:border-[#d7b699] hover:text-[#173f49]"
          >
            View all
            <span className="rounded-full bg-[#f6f0e6] px-1.5 py-0.5 text-[10px] font-semibold text-[#57656f]">
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
                    ? "border-[#d8e5e7] bg-[#eef5f5] hover:bg-[#e7f0f1]"
                    : "border-[#eadfce] bg-[#f9f5ee] hover:bg-[#f4efe7]"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#132129]">{item.title}</div>
                    <div className="mt-0.5 text-xs text-[#62707a]">{item.message}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-[#7a848d]">{timeAgo(item.created_at)}</span>
                    {item.unread && (
                      <span className="rounded-full bg-[#dce9eb] px-2 py-0.5 text-[10px] font-semibold text-[#173f49]">
                        Unread
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#e2d4bf] bg-[#f8f3eb] px-4 py-8 text-center text-sm text-[#66717b]">
            No notifications available right now.
          </div>
        )}
      </div>
    </div>
  );
}
