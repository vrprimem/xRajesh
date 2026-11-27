import type { Metadata } from "next";
import { DayBookView } from "@/components/supplier/day-book";
import { requirePortalUser } from "@/lib/auth";
import { bookRange, bookShow } from "@/lib/day-book";
import { todayIST } from "@/lib/format";
import { loadDayBook } from "@/server/day-book-data";
import { ownerPage } from "@/server/staff-pages";

export const metadata: Metadata = { title: "Day book" };

/** The supplier's day book: goods in and dispatch between two dates. The owner's alone, not the warehouse person's. */
export default async function SupplierDayBookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  ownerPage(user);
  const sp = await searchParams;
  const today = todayIST();
  const range = bookRange(sp.from, sp.to, today);
  const data = await loadDayBook(user.supplierId, range.from, range.to);
  return <DayBookView data={data} range={range} show={bookShow(sp.show)} today={today} base="/supplier/daybook" dispatchHref={(d) => `/supplier/dispatches/${d}`} title="Day book" />;
}
