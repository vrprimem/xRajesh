"use server";

import { createClient as createSessionClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveUser, isOwner } from "@/lib/auth";
import { logError } from "@/lib/redact";
import { getAdmin } from "@/lib/supabase/admin";
import { supabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { fieldErrors } from "@/lib/validation";

// The owner's factory reset. What goes, what stays and every lock are in
// supabase/migrations/20261123107000_factory_reset.sql; the database checks all of it, the app only asks.
//   1. sendResetCode: notes the request in the database, then has Supabase email the owner a one-time code.
//   2. confirmFactoryReset: checks the code with Supabase, which answers with a session marked "signed in with a
//      code", and asks the database to wipe using that session. Then removes the vehicle photo files, which only the
//      Storage API can delete.
// Nothing here talks to the inventory software.

const OWNER_ONLY = "Only the owner can reset the portal.";
const NO_EMAIL = "Your login has no email address to send a code to.";

export async function sendResetCode(): Promise<ActionResult> {
  const user = await getActiveUser();
  if (!user || !isOwner(user)) return { ok: false, message: OWNER_ONLY };
  if (!user.email) return { ok: false, message: NO_EMAIL };

  const supabase = await createClient();
  const { error: requestError } = await supabase.rpc("factory_reset_request");
  if (requestError) {
    logError("factory reset request", requestError);
    return { ok: false, message: "Could not start the reset. Try again." };
  }
  const { error } = await supabase.auth.signInWithOtp({ email: user.email, options: { shouldCreateUser: false } });
  if (error) {
    logError("factory reset code", error);
    const tooMany = error.status === 429 || /rate limit|security purposes/i.test(error.message);
    return { ok: false, message: tooMany ? "Too many codes asked for. Wait a minute, then try again." : "Could not send the code. Try again in a minute." };
  }
  return { ok: true, message: `Code sent to ${user.email}` };
}

const confirmSchema = z.object({
  scope: z.enum(["activity", "everything"], "Choose what to wipe"),
  code: z.string().trim().regex(/^\d{6,10}$/, "Enter the code from the email"),
  confirm: z.string().trim().refine((v) => v.toUpperCase() === "RESET", "Type RESET"),
});

export async function confirmFactoryReset(input: unknown): Promise<ActionResult<{ counts: Record<string, number> }>> {
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const user = await getActiveUser();
  if (!user || !isOwner(user)) return { ok: false, message: OWNER_ONLY };
  if (!user.email) return { ok: false, message: NO_EMAIL };
  const { scope, code } = parsed.data;

  const supabase = await createClient();
  const { data: verified, error: codeError } = await supabase.auth.verifyOtp({ email: user.email, token: code, type: "email" });
  if (codeError || !verified.session) {
    return { ok: false, message: "That code is wrong or has expired. Ask for a new one.", fieldErrors: { code: "Wrong or expired code" } };
  }

  // Wipe with the session the code just made, so the database can see it came from an emailed code.
  const { url, key } = supabaseEnv();
  const withCode = createSessionClient(url, key, {
    global: { headers: { Authorization: `Bearer ${verified.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await withCode.rpc("factory_reset", { p_scope: scope });
  if (error) {
    logError("factory reset", error);
    const known = /Ask for a new code first|Confirm with the code from your email first|Only the owner can reset the portal/.exec(error.message);
    return { ok: false, message: known ? `${known[0]}. Nothing was deleted.` : "The reset did not run, so nothing was deleted. Try again." };
  }
  const result = data as { counts: Record<string, number>; photos: string[] | null };

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
  return { ok: true, message: scope === "everything" ? "Factory reset done" : "Test activity cleared", data: { counts: result.counts } };
}
