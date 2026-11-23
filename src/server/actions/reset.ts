"use server";

import { createClient as createSessionClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { z } from "zod";
import { getActiveUser, isOwner } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { getAdmin } from "@/lib/supabase/admin";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { groupKey, keyFromHex, otpauthUri } from "@/lib/totp";
import type { ActionResult } from "@/lib/types";
import { fieldErrors } from "@/lib/validation";

// The owner's factory reset, confirmed with an authenticator app. What goes, what stays and every lock are in
// supabase/migrations/20261123108000_factory_reset_authenticator.sql; the database checks all of it, the app only asks.
//   linkAuthenticator:  checks the owner's password, then asks the database for a new secret, shown once as a QR code.
//   finishAuthenticator: the app's first code; the database links the app if it is right.
//   confirmFactoryReset: the app's current code and the level; the database checks the code and wipes. Then the vehicle
//                        photo files go, which only the Storage API can delete.
// Nothing here talks to the inventory software.

const OWNER_ONLY = "Only the owner can reset the portal.";
const CODE = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the app");

/** Plain words for what the database said about a code. */
function codeProblem(reason: unknown): string {
  if (reason === "locked") return "Too many wrong codes. Codes are refused for 15 minutes; try again after that.";
  if (reason === "missing") return "Link your authenticator app first.";
  return "That code is wrong or already used. Enter the newest code the app shows.";
}

async function owner() {
  const user = await getActiveUser();
  return user && isOwner(user) ? user : null;
}

export async function linkAuthenticator(input: unknown): Promise<ActionResult<{ qr: string; key: string }>> {
  const parsed = z.object({ password: z.string().min(1, "Enter your password") }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter your password.", fieldErrors: fieldErrors(parsed.error) };
  const user = await owner();
  if (!user) return { ok: false, message: OWNER_ONLY };
  if (!user.email) return { ok: false, message: "Your login has no email address, so the password cannot be checked." };

  // Signing in again proves the password; the database only links an app for a password sign-in in the last 10 minutes.
  const supabase = await createClient();
  const { data: signedIn, error: passwordError } = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.data.password });
  if (passwordError || !signedIn.session) {
    return { ok: false, message: "Wrong password.", fieldErrors: { password: "Wrong password" } };
  }
  const { url, key } = supabaseEnv();
  const fresh = createSessionClient(url, key, {
    global: { headers: { Authorization: `Bearer ${signedIn.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: hex, error } = await fresh.rpc("reset_authenticator_begin");
  if (error || typeof hex !== "string") {
    if (error && /already linked/.test(error.message)) return { ok: false, message: "An authenticator app is already linked." };
    logError("reset authenticator begin", error);
    return { ok: false, message: "Could not start linking the app. Try again." };
  }

  const secret = keyFromHex(hex);
  const svg = await QRCode.toString(otpauthUri(secret, user.email), { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return { ok: true, message: "Scan the QR code", data: { qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, key: groupKey(secret) } };
}

export async function finishAuthenticator(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ code: CODE }).safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the code.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await owner())) return { ok: false, message: OWNER_ONLY };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_authenticator_confirm", { p_code: parsed.data.code });
  if (error) {
    logError("reset authenticator confirm", error);
    return { ok: false, message: "Could not check the code. Try again." };
  }
  if (data !== "ok") {
    return { ok: false, message: data === "missing" ? "Show the QR code again and scan it." : codeProblem(data), fieldErrors: { code: "Wrong code" } };
  }
  revalidatePath("/suppliers/reset");
  return { ok: true, message: "Authenticator app linked" };
}

const resetSchema = z.object({
  scope: z.enum(["activity", "everything"], "Choose what to wipe"),
  code: CODE,
  confirm: z.string().trim().refine((v) => v.toUpperCase() === "RESET", "Type RESET"),
});

export async function confirmFactoryReset(input: unknown): Promise<ActionResult<{ counts: Record<string, number> }>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  if (!(await owner())) return { ok: false, message: OWNER_ONLY };
  const { scope, code } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("factory_reset", { p_scope: scope, p_code: code });
  if (error) {
    logError("factory reset", error);
    return { ok: false, message: "The reset did not run, so nothing was deleted. Try again." };
  }
  const result = data as { ok: boolean; reason?: string; counts?: Record<string, number>; photos?: string[] | null };
  if (!result.ok) return { ok: false, message: `${codeProblem(result.reason)} Nothing was deleted.`, fieldErrors: { code: "Wrong code" } };

  // Vehicle photos are files: only the Storage API can remove them.
  const photos = result.photos ?? [];
  if (photos.length) {
    const { admin, problem } = getAdmin();
    if (problem !== null) logError("factory reset photos", problem);
    else {
      for (let i = 0; i < photos.length; i += 500) {
        const { error: removeError } = await admin.storage.from("supplier-photos").remove(photos.slice(i, i + 500));
        if (removeError) logError("factory reset photos", removeError);
      }
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, message: scope === "everything" ? "Factory reset done" : "Test activity cleared", data: { counts: result.counts ?? {} } };
}
