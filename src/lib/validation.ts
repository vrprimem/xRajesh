import { z } from "zod";

// What forms send, checked on the server before anything is saved.

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  password: z.string().min(1, "Enter your password"),
});

export const password = z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters");

export const changePasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match" });

export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(1000).refine((u) => u.startsWith("https://"), "Push endpoint must be https"),
  p256dh: z.string().min(20).max(200),
  auth: z.string().min(8).max(100),
});

/** The first problem of each field, by field name. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
