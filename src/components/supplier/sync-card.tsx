"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useToast } from "@/components/toast";
import { Card, Chip, buttonClass } from "@/components/ui";
import { formatDateTime, formatNumber } from "@/lib/format";
import { requestStockSync } from "@/server/actions/supplier";
import type { SyncState } from "@/server/supplier-data";

/** When VRPRIME's stock was last read from the inventory software, whether the last try failed, and "Sync now". */
export function SyncCard({ state }: { state: SyncState | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const failed = Boolean(state?.last_error);
  return (
    <Card className="g-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-card-title flex flex-wrap items-center gap-2">
            Stock from the inventory software
            {failed ? <Chip tone="bad">Last sync failed</Chip> : state?.last_ok_at ? <Chip tone="ok">Working</Chip> : <Chip tone="warn">Not read yet</Chip>}
          </p>
          <p className="t-caption mt-1">
            {state?.last_ok_at ? `Last read ${formatDateTime(state.last_ok_at)}${state.last_products ? `: ${formatNumber(state.last_products)} products` : ""}. ` : ""}
            Read every 30 minutes. Warehouses and master SKUs come from it too.
          </p>
          {failed ? <p className="mt-1 text-[13px] font-semibold text-bad">{state?.last_error}</p> : null}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (toast.result(await requestStockSync())) window.setTimeout(() => router.refresh(), 6000);
            })
          }
          className={buttonClass("outline")}
        >
          {pending ? "Starting..." : "Sync now"}
        </button>
      </div>
    </Card>
  );
}
