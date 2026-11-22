"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";

/** Shown when a page fails to load: a plain message, Try again, and a way home. Nothing technical is shown. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error("Page failed", error instanceof Error ? error.name : "error");
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-[480px] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="t-card-title">Something went wrong</h1>
      <p className="t-caption">This page could not load. Check your connection and try again. If it keeps happening, tell VRPRIME what you were doing.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("outline")}>
          Home
        </Link>
      </div>
    </main>
  );
}
