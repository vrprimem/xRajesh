"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { NotificationRow } from "@/lib/types";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/notifications";

/** Only ever a page of this site: a notification can never send anyone elsewhere. */
const safeUrl = (url: string | null) => (url && /^\/[a-z0-9/_-]*$/i.test(url) ? url : null);

/** The person's alerts, newest first. Tapping one marks it read and opens the page it is about. */
export function NotificationList({ items }: { items: NotificationRow[] }) {
  const router = useRouter();
  // Marked read in this browser a moment ago, before the page has reloaded.
  const [readHere, setReadHere] = useState<Set<string>>(new Set());

  const open = (n: NotificationRow) => {
    if (!n.read_at && !readHere.has(n.id)) {
      setReadHere((set) => new Set(set).add(n.id));
      void markNotificationRead(n.id);
    }
    const url = safeUrl(n.url);
    if (url) router.push(url);
  };

  return (
    <ul className="sp-card m-0 flex list-none flex-col divide-y divide-line-soft overflow-hidden p-0">
      {items.map((n) => {
        const unread = !n.read_at && !readHere.has(n.id);
        return (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)} className="focus-ring flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-160 hover:bg-panel2">
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[14px] ${unread ? "font-semibold" : ""}`}>
                  {unread ? <span className="sr-only">Unread: </span> : null}
                  {n.title}
                </span>
                {n.body ? <span className="mt-0.5 block text-[13px] text-muted">{n.body}</span> : null}
                <span className="t-caption mt-1 block">{formatDateTime(n.created_at)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MarkAllReadButton() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (toast.result(await markAllNotificationsRead())) router.refresh();
        })
      }
      className={buttonClass("secondary", "shrink-0")}
    >
      {pending ? "Marking..." : "Mark all read"}
    </button>
  );
}
