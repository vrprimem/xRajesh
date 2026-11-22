import type { Metadata } from "next";
import { MarkAllReadButton, NotificationList } from "@/components/notifications/notification-list";
import { PushSettings } from "@/components/notifications/push-settings";
import { EmptyState, PageTitle } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Alerts" };

/** The supplier's alerts, and the switch that sends them to this phone as notifications. */
export default async function SupplierAlertsPage() {
  const user = await requirePortalUser();
  const supabase = await createClient();
  // The database returns only this person's own notifications.
  const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="mx-auto max-w-[780px]">
      <PageTitle title="Alerts" sub={unread ? `${unread} unread` : items.length ? "You are all caught up" : undefined} action={unread ? <MarkAllReadButton /> : undefined} />
      <PushSettings userId={user.id} />
      {items.length ? <NotificationList items={items} /> : <EmptyState title="No alerts yet" body="You are told here when a product falls below its minimum at VRPRIME. Turn notifications on above to get them on this phone." />}
    </div>
  );
}
