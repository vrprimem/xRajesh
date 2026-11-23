import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MoneyPanel } from "@/components/supplier/money-panel";
import { EmptyState, PageTitle, buttonClass } from "@/components/ui";
import { requirePortalUser } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { averageRates, costSheet, monthMoney } from "@/lib/money";
import { monthBounds, shiftMonth } from "@/lib/report";
import { loadItemStock, loadMoney, loadProduction, loadReadyStock, loadRecipes, monthEnd, unitsMadeBetween } from "@/server/supplies-data";

export const metadata: Metadata = { title: "Money" };

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** The supplier's money for a month, for its owner only: not the warehouse person, not VRPRIME (the database agrees). */
export default async function SupplierMoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePortalUser();
  if (user.role !== "supplier_owner") notFound();
  const sp = await searchParams;
  const today = todayIST();
  const asked = typeof sp.month === "string" ? sp.month : "";
  const month = monthBounds(asked) && asked <= today.slice(0, 7) ? asked : today.slice(0, 7);
  const [money, stock, ready, recipes, entries] = await Promise.all([
    loadMoney(user.supplierId, month),
    loadItemStock(user.supplierId),
    loadReadyStock(user.supplierId),
    loadRecipes(user.supplierId),
    loadProduction(user.supplierId, `${month}-01`),
  ]);
  if (!money.installed) return <EmptyState title="Not ready yet" body="Money is still being set up for your portal. Try again in a little while." />;

  const totals = monthMoney(money.purchases, money.payments, money.costs);
  const sheet = costSheet(
    ready.rows.map((r) => ({ id: r.product_id, name: r.name, units_per_carton: r.units_per_carton, active: r.active })),
    recipes,
    averageRates(money.priced),
    new Map(stock.items.map((i) => [i.id, i.name])),
    unitsMadeBetween(entries, `${month}-01`, monthEnd(month)),
    totals.costsTotal,
  );
  const next = shiftMonth(month, 1);

  return (
    <>
      <PageTitle
        title="Money"
        sub={`${monthName(month)} · only you see this page`}
        action={
          <>
            <Link href={`/supplier/money?month=${shiftMonth(month, -1)}`} className={buttonClass("row")}>
              Previous month
            </Link>
            {next <= today.slice(0, 7) ? (
              <Link href={`/supplier/money?month=${next}`} className={buttonClass("row")}>
                Next month
              </Link>
            ) : null}
          </>
        }
      />
      <MoneyPanel month={month} data={money} totals={totals} sheet={sheet} items={stock.items} today={today} />
    </>
  );
}
