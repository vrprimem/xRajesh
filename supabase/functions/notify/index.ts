// Edge Function `notify`: sends one saved notification to the person's phones as a push message.
//
// Called only by the database (pg_net), when a row is added to public.notifications:
//   { "job": "push", "notification_id": "<uuid>" }
//
// Every request must carry `x-internal-secret`, which this function checks with the database, so "Verify JWT" is off.
// If push is not set up or fails, the notification is still in the app: only the push is lost.
//
// Secrets (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and optionally VAPID_SUBJECT
// (a mailto: address or the site's https address).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

/** Keeps keys and tokens out of logs and responses. */
function redact(input: unknown): string {
  let text = String(input ?? "");
  const vapid = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  if (vapid && vapid.length >= 8) text = text.split(vapid).join("[redacted]");
  return text
    .replace(/(["'`])[^"'`\n]*(?:sb_secret_|sb_publishable_|eyJ[\w-]{5,}|Bearer\s)[^"'`\n]*\1/gi, "[redacted]")
    .replace(/Bearer\s+[^\s"'`,;)]+/gi, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[^\s"'`,;)]*/gi, "[redacted]")
    .replace(/eyJ[\w-]{5,}(?:\.[\w-]+){0,2}/g, "[redacted]");
}

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return redact((error as { message: unknown }).message);
  return redact(error);
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string" && keys.default) return keys.default;
  } catch {
    // Fall back to the legacy key below.
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** True when VAPID keys are set and accepted. Checked on every call so new secrets work at once. */
function configurePush(): boolean {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")?.trim() || "mailto:admin@example.com", publicKey, privateKey);
    return true;
  } catch (error) {
    console.error("VAPID keys were rejected:", errorText(error));
    return false;
  }
}

/** Only ever a page of the site. */
const safeUrl = (url: unknown): string => (typeof url === "string" && /^\/[A-Za-z0-9/_-]*$/.test(url) ? url : "/");

async function pushJob(db: SupabaseClient, notificationId: string): Promise<Record<string, unknown>> {
  const { data: n, error } = await db.from("notifications").select("id, user_id, kind, title, body, url").eq("id", notificationId).maybeSingle();
  if (error) throw error;
  if (!n) return { ok: false, error: "notification not found" };
  if (!configurePush()) return { ok: true, pushed: false, reason: "push is not configured (VAPID keys missing)" };

  const { data: subs, error: subsError } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  if (subsError) throw subsError;
  const result = { sent: 0, removed: 0, failed: 0, devices: subs.length };
  const payload = JSON.stringify({ title: n.title, body: n.body ?? "", url: safeUrl(n.url), tag: `${n.kind}:${n.id}` });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 60 * 60 * 24, urgency: "normal" });
        result.sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The device unsubscribed or the app was removed: forget it.
          await db.from("push_subscriptions").delete().eq("id", sub.id);
          result.removed += 1;
        } else {
          result.failed += 1;
          console.error("Push failed", status ?? "no status", errorText(error));
        }
      }
    }),
  );
  return { ok: true, pushed: true, ...result };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const db = adminClient();
    const { data: allowed, error: authError } = await db.rpc("check_internal_secret", { candidate: req.headers.get("x-internal-secret") ?? "" });
    if (authError) {
      console.error("Secret check failed:", errorText(authError));
      return json({ ok: false, error: "could not verify the request" }, 500);
    }
    if (allowed !== true) return json({ ok: false, error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (body?.job === "push" && typeof body.notification_id === "string") return json(await pushJob(db, body.notification_id));
    return json({ ok: false, error: "unknown job" }, 400);
  } catch (error) {
    console.error("notify failed:", errorText(error));
    return json({ ok: false, error: errorText(error) }, 500);
  }
});
