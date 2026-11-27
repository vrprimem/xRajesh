import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DayBookView } from "@/components/supplier/day-book";
import { buttonClass } from "@/components/ui";
import { canManage, requireUser } from "@/lib/auth";
import { bookRange, bookShow } from "@/lib/day-book";
import { todayIST } from "@/lib/format";
import { loadDayBook } from "@/server/day-book-data";
import { loadSupplier } from "@/server/supplier-data";

export const metadata: Metadata = { title: "Supplier day book" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A supplier's day book, as VRPRIME sees it (owner and admin): goods in and dispatch between two dates. */
export default async function SupplierDayBookAdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!canManage(user)) notFound();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const supplier = await loadSupplier(id);
  if (!supplier) notFound();
  const today = todayIST();
  const range = bookRange(sp.from, sp.to, today);
  const data = await loadDayBook(id, range.from, range.to);
  return (
    <>
      <div className="mb-2">
        <Link href={`/suppliers/${id}`} className={buttonClass("row")}>
          Back to {supplier.name}
        </Link>
      </div>
      <DayBookView data={data} range={range} show={bookShow(sp.show)} today={today} base={`/suppliers/${id}/daybook`} dispatchHref={(d) => `/suppliers/${id}/dispatches/${d}`} title={`${supplier.name}: day book`} />
    </>
  );
}
