import Link from "next/link";
import { notFound } from "next/navigation";
import { DispatchList, MonthCartons } from "@/components/supplier/dispatch-list";
import AuthLayout from "@/app/(auth)/layout";
import { SignInDoor } from "@/components/auth/sign-in-door";
import { PortalShell } from "@/components/portal-shell";
import { DeliveryPlans } from "@/components/supplier/delivery-plans";
import { DispatchForm } from "@/components/supplier/dispatch-form";
import { DispatchPanel } from "@/components/supplier/dispatch-panel";
import { FactoryReset } from "@/components/supplier/factory-reset";
import { Label, LABEL_CSS } from "@/components/supplier/label";
import { MoneyPanel } from "@/components/supplier/money-panel";
import { OutputChart } from "@/components/supplier/output-chart";
import { PlanForm } from "@/components/supplier/plan-form";
import { PlanList } from "@/components/supplier/plan-list";
import { ProduceList } from "@/components/supplier/produce-list";
import { ProductionForm, ProductionLog, ReadyStockTable, RecipeEditor } from "@/components/supplier/production-panel";
import { ProductsPanel } from "@/components/supplier/products-panel";
import { Scanner } from "@/components/supplier/scanner";
import { StockTable } from "@/components/supplier/stock-table";
import { StaffLogins, SupplierLogins } from "@/components/supplier/supplier-admin";
import { SuppliesPanel } from "@/components/supplier/supplies-panel";
import { SyncCard } from "@/components/supplier/sync-card";
import { Card, PageTitle, SectionHead, buttonClass } from "@/components/ui";
import type { CartonType } from "@/lib/supplier";
import { PHONE_LINKS, supplierLinks } from "@/lib/supplier-nav";
import { factorySample } from "./factory-sample";
import type { CartonRow, DispatchDetail, DispatchSummary, PlanRow, ProduceRow, ProductRow, StockRow } from "@/server/supplier-data";

// The supplier portal's screens with fake data and no login, for checking layout at 360px, in dark mode and in print.
// Development only: 404 in production. Buttons that save will fail here (there is no database behind them).

const SUPPLIER = "00000000-0000-4000-8000-000000000001";
const DISPATCH = "00000000-0000-4000-8000-0000000000d1";
const pid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
// Like the inventory software's numbers: 1, the warehouse (01), then a running number.
const code = (n: number) => `101${String(n).padStart(13, "0")}`;

const PRODUCTS: ProductRow[] = [
  { id: pid(1), name: "Kitchen Cleaner Spray 500ml", master_id: pid(51), master_code: "150-KITCHEN", category: "kitchen_cleaner", units_per_carton: 24, daily_capacity: 1200, active: true, weight_per_carton: 8.5 },
  { id: pid(2), name: "Rat Repellent Spray 300ml", master_id: pid(52), master_code: "160-RAT", category: "repellent", units_per_carton: 48, daily_capacity: 900, active: true, weight_per_carton: 8.5 },
  { id: pid(3), name: "Lizard Repellent Spray 250ml", master_id: null, master_code: null, category: "repellent", units_per_carton: 60, daily_capacity: null, active: true, weight_per_carton: 8.5 },
  { id: pid(4), name: "Scratch Remover Bottle 150ml", master_id: pid(54), master_code: "150-SCRATCH", category: "other_cleaning", units_per_carton: 110, daily_capacity: 2000, active: false, weight_per_carton: 8.5 },
];

// Sample product photos (drawn here, not real pictures).
const bottle = (fill: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#fff"/><rect x="41" y="6" width="18" height="14" rx="3" fill="#111"/><path d="M35 20h30v10l7 9v52a5 5 0 0 1-5 5H33a5 5 0 0 1-5-5V39l7-9z" fill="${fill}"/><rect x="32" y="52" width="36" height="22" rx="2" fill="#fff"/><text x="50" y="67" font-size="12" font-family="Arial" font-weight="700" text-anchor="middle" fill="#111">${label}</text></svg>`)}`;
const PHOTOS: Record<string, string> = { [pid(1)]: bottle("#ffd60a", "KC"), [pid(2)]: bottle("#16a34a", "RR") };

// A sample of the inventory software's products, for trying the master SKU search without a database.
const MASTERS = [
  { code: "150-KITCHEN", name: "Kitchen Cleaner Spray 500ml" },
  { code: "150-KITCHEN-1L", name: "Kitchen Cleaner Refill 1L" },
  { code: "150-GLASS", name: "Glass Cleaner 500ml" },
  { code: "150-BATH", name: "Bathroom Cleaner 500ml" },
  { code: "150-FLOOR", name: "Floor Cleaner Lavender 1L" },
  { code: "150-SCRATCH BOTTLE", name: "Scratch Remover Bottle 150ml" },
  { code: "160-RAT", name: "Rat Repellent Spray 300ml" },
  { code: "160-LIZARD", name: "Lizard Repellent Spray 250ml" },
  { code: "160-COCKROACH", name: "Cockroach Repellent Spray 250ml" },
];

function fakeCartons(): CartonRow[] {
  const out: CartonRow[] = [];
  const add = (product: ProductRow, type: CartonType, count: number, loaded: number) => {
    for (let i = 0; i < count; i++) {
      const no = out.length + 1;
      out.push({ id: `c${no}`, product_id: product.id, product: product.name, carton_type: type, units: product.units_per_carton, carton_no: no, barcode: code(4800 + no), status: i < loaded ? "loaded" : "issued", loaded_at: i < loaded ? "2026-11-23T05:40:00Z" : null, void_reason: null, inbound_status: null, weight_per_carton: type === "H" ? 8.5 : 6.2 });
    }
  };
  add(PRODUCTS[0], "H", 6, 4);
  add(PRODUCTS[1], "T", 5, 1);
  out[5] = { ...out[5], status: "void", void_reason: "reprinted" };
  out.push({ ...out[5], id: "c12", carton_no: 12, barcode: code(4812), status: "issued", void_reason: null });
  return out;
}

const DETAIL: DispatchDetail = {
  dispatch: { id: DISPATCH, supplier_id: SUPPLIER, number: 7, status: "loading", due_on: "2026-11-24", note: "Tempo MH04 AB 1234, driver Suresh", vehicle_photo_path: null, created_at: "2026-11-22T10:00:00Z", closed_at: null, received_at: null, labels_run_at: null, labels_error: null },
  lines: [
    { product_id: pid(1), product: PRODUCTS[0].name, carton_type: "H", units_per_carton: 24, cartons: 6 },
    { product_id: pid(2), product: PRODUCTS[1].name, carton_type: "T", units_per_carton: 48, cartons: 5 },
  ],
  cartons: fakeCartons(),
  photoUrl: null,
};

const summary = (d: DispatchDetail, arrived = 0): DispatchSummary => ({
  ...d.dispatch,
  lines: d.lines,
  cartons: d.cartons.map((c, i) => ({ dispatch_id: d.dispatch.id, product_id: c.product_id, carton_type: c.carton_type, status: arrived ? ("loaded" as const) : c.status, units: c.units, void_reason: c.void_reason, inbound_status: i < arrived ? ("received" as const) : null, inbound_at: i < arrived ? "2026-11-21T06:00:00Z" : null })),
});
const DISPATCHES: DispatchSummary[] = [
  summary(DETAIL),
  { ...summary(DETAIL, 7), id: "d6", number: 6, status: "closed", due_on: "2026-11-18", closed_at: "2026-11-18T09:00:00Z" },
  { ...summary(DETAIL, 12), id: "d5", number: 5, status: "received", due_on: "2026-11-12", closed_at: "2026-11-12T09:00:00Z", received_at: "2026-11-13T07:00:00Z" },
  { ...summary(DETAIL), id: "d4", number: 4, status: "planned", due_on: "2026-11-18", cartons: [] },
];

const STOCK: StockRow[] = [
  { product_id: pid(1), name: PRODUCTS[0].name, master_code: "150-KITCHEN", units_per_carton: 24, active: true, stock_units: 310, in_transit_units: 96, min_units: 600, synced_at: "2026-11-23T06:00:00Z" },
  { product_id: pid(2), name: PRODUCTS[1].name, master_code: "160-RAT", units_per_carton: 48, active: true, stock_units: 2400, in_transit_units: 0, min_units: 1000, synced_at: "2026-11-23T06:00:00Z" },
  { product_id: pid(3), name: PRODUCTS[2].name, master_code: null, units_per_carton: 60, active: true, stock_units: null, in_transit_units: 0, min_units: null, synced_at: "2026-11-23T06:00:00Z" },
];

const PRODUCE: ProduceRow[] = [
  { id: "q1", product_id: pid(1), product: PRODUCTS[0].name, status: "open", stock_units: 310, in_transit_units: 96, min_units: 600, suggested_units: 816, raised_at: "2026-11-23T06:20:00Z", responded_at: null },
  { id: "q2", product_id: pid(2), product: "Glass Cleaner 500ml", status: "in_production", stock_units: 40, in_transit_units: 0, min_units: 300, suggested_units: 576, raised_at: "2026-11-21T06:20:00Z", responded_at: "2026-11-21T08:00:00Z" },
];

const PLANS: PlanRow[] = [
  { id: "p2", number: 2, due_on: "2026-11-26", note: "Kitchen cleaner first, Flipkart sale on 28th", status: "open", dispatch_id: null, created_at: "2026-11-23T06:00:00Z", responded_at: null, lines: [
    { product_id: pid(1), product: PRODUCTS[0].name, carton_type: "H", units_per_carton: 24, cartons: 40 },
    { product_id: pid(2), product: PRODUCTS[1].name, carton_type: "T", units_per_carton: 48, cartons: 15 },
  ] },
  { id: "p1", number: 1, due_on: "2026-11-21", note: null, status: "in_production", dispatch_id: null, created_at: "2026-11-18T06:00:00Z", responded_at: "2026-11-18T09:00:00Z", lines: [
    { product_id: pid(1), product: PRODUCTS[0].name, carton_type: "H", units_per_carton: 24, cartons: 25 },
  ] },
];

const VIEWS = ["home", "production", "supplies", "money", "more", "delivery", "newdispatch", "dispatch", "scan", "labels", "products", "vrprime", "plan", "reset", "signin"] as const;

const PREVIEW_HREF: Record<string, string> = { "/supplier": "/dev/supplier", "/supplier/production": "/dev/supplier?view=production", "/supplier/dispatches": "/dev/supplier?view=dispatch", "/supplier/money": "/dev/supplier?view=money", "/supplier/supplies": "/dev/supplier?view=supplies", "/supplier/products": "/dev/supplier?view=products", "/supplier/reports": "/dev/supplier?view=vrprime", "/supplier/alerts": "/dev/supplier?view=plan" };

export default async function SupplierPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const sp = await searchParams;
  const view = VIEWS.find((v) => v === sp.view) ?? "home";
  const who = sp.who === "scanner" ? "scanner" : "owner";
  const f = factorySample(PLANS.map((p) => ({ id: p.id, number: p.number, due_on: p.due_on, lines: p.lines })));
  const navLinks = supplierLinks(who === "owner" ? "supplier_owner" : "supplier_scanner", 3).map((l) => ({ ...l, href: PREVIEW_HREF[l.href] ?? l.href }));

  if (view === "signin") {
    return (
      <AuthLayout>
        <SignInDoor door={sp.door === "admin" ? "admin" : "supplier"} />
      </AuthLayout>
    );
  }

  return (
    <PortalShell
      home="/dev/supplier"
      title="Rajesh Industries"
      sub="VRPRIME supplier portal · Rajesh"
      links={navLinks}
      more="/dev/supplier?view=more"
    >
      <nav className="mb-4 flex flex-wrap gap-2 print:hidden" aria-label="Preview">
        {VIEWS.map((v) => (
          <Link key={v} href={`/dev/supplier?view=${v}`} className={buttonClass(v === view ? "secondary" : "row")}>
            {v}
          </Link>
        ))}
      </nav>

      {view === "home" ? (
        <div className="flex flex-col gap-4">
          <PageTitle title="Today" sub="2 things need your answer" />
          <Card className="g-pad">
            <SectionHead title="What VRPRIME wants next" sub="Make these, tell VRPRIME how far you are, and make the dispatch when ready." />
            <PlanList plans={PLANS} who="owner" dispatchBase="/dev/supplier" photos={PHOTOS} />
          </Card>
          <Card className="g-pad">
            <SectionHead title="Produce now" sub="Products under their minimum at VRPRIME, counting what is already on the way." />
            <ProduceList rows={PRODUCE} canAnswer photos={PHOTOS} />
          </Card>
          <MonthCartons dispatches={DISPATCHES} />
          <DispatchList dispatches={DISPATCHES} base="/dev/supplier" who={who} photos={PHOTOS} warehouse="Bhiwandi" emptyBody="" />
          <StockTable rows={STOCK} canSetMin={false} />
        </div>
      ) : null}

      {view === "production" ? (
        <div className="flex flex-col gap-4">
          <PageTitle title="Production" sub="Today 480 units · last 7 days 6,970" />
          <ProductionForm products={f.ready} today={f.today} />
          <Card className="g-pad">
            <SectionHead title="Made each day" sub="Units of all products, the last 14 days." />
            <OutputChart days={f.days} today={f.today} title="Units made each day, the last 14 days" />
          </Card>
          <DeliveryPlans estimates={f.estimates} today={f.today} empty="No open send plan from VRPRIME right now." />
          <ReadyStockTable rows={f.ready} canCount />
          <ProductionLog entries={f.entries} products={f.ready} today={f.today} canRemove />
          <RecipeEditor products={f.ready} items={f.items} recipes={f.recipes} canEdit={who === "owner"} />
        </div>
      ) : null}

      {view === "supplies" ? (
        <>
          <PageTitle title="Supplies" sub="9 in use · 2 running low" />
          <SuppliesPanel supplierId={SUPPLIER} items={f.items} moves={f.moves} daysLeft={f.daysLeft} canEdit={who === "owner"} canCount />
        </>
      ) : null}

      {view === "money" ? (
        <>
          <PageTitle title="Money" sub="This month · only you see this page" />
          <MoneyPanel month={f.month} data={f.money} totals={f.totals} sheet={f.sheet} items={f.items} today={f.today} />
        </>
      ) : null}

      {view === "more" ? (
        <>
          <PageTitle title="More" />
          <ul className="grid gap-3 min-[520px]:grid-cols-2">
            {navLinks.slice(PHONE_LINKS).map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="sp-card focus-ring flex min-h-16 items-center justify-between gap-3 px-5 py-4 text-[20px] font-extrabold hover:bg-surface2">
                  {l.label}
                  <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {view === "delivery" ? (
        <div className="flex flex-col gap-4">
          <PageTitle title="Rajesh Industries: production" sub="Today 480 units · last 7 days 6,970 · as the supplier enters it" />
          <Card className="g-pad">
            <SectionHead title="Made each day" sub="Units of all products, the last 14 days." />
            <OutputChart days={f.days} today={f.today} title="Units made each day, the last 14 days" />
          </Card>
          <DeliveryPlans estimates={f.estimates} today={f.today} empty="No open send plan." />
          <ReadyStockTable rows={f.ready} canCount={false} />
          <ProductionLog entries={f.entries} products={f.ready} today={f.today} canRemove={false} />
          <SuppliesPanel supplierId={SUPPLIER} items={f.items} moves={f.moves} daysLeft={f.daysLeft} canEdit={false} canCount={false} />
        </div>
      ) : null}

      {view === "newdispatch" ? (
        <>
          <PageTitle title="New dispatch" sub="Labels are made by the inventory software as soon as you save" />
          <DispatchForm supplierId={SUPPLIER} products={PRODUCTS} base="/dev/supplier" tomorrow="2026-11-24" photos={PHOTOS} />
        </>
      ) : null}

      {view === "dispatch" ? (
        <>
          <PageTitle title="Dispatch 7" />
          <DispatchPanel detail={DETAIL} who={who} base="/dev/supplier" photos={PHOTOS} />
        </>
      ) : null}

      {view === "scan" ? (
        <Scanner dispatchId={DISPATCH} number={7} backHref="/dev/supplier?view=dispatch" planned={11} cartons={DETAIL.cartons.map((c) => ({ barcode: c.barcode, carton_no: c.carton_no, product: c.product, status: c.status }))} />
      ) : null}

      {view === "labels" ? (
        <>
          <style dangerouslySetInnerHTML={{ __html: LABEL_CSS }} />
          <div className="vr-label-sheet">
            {[DETAIL.cartons[0], DETAIL.cartons[6], DETAIL.cartons[11]].map((c) => (
              <Label key={c.id} carton={c} dispatchNo={7} due="24 Nov" />
            ))}
          </div>
        </>
      ) : null}

      {view === "products" ? (
        <>
          <PageTitle title="Products" sub="3 active" />
          <ProductsPanel supplierId={SUPPLIER} products={PRODUCTS} canEdit={who === "owner" || sp.who === "vrprime"} demoMasters={MASTERS} photos={PHOTOS} canPhoto={sp.who === "vrprime"} />
        </>
      ) : null}

      {view === "plan" ? (
        <>
          <PageTitle title="Rajesh Industries: new send plan" sub="Tell the supplier what to make and send next" />
          <PlanForm supplierId={SUPPLIER} supplierName="Rajesh Industries" rows={STOCK} defaultDue="2026-11-26" back="/dev/supplier" photos={PHOTOS} />
        </>
      ) : null}

      {view === "reset" ? (
        <>
          <PageTitle title="Factory reset" sub="Wipes the portal's data. It cannot be undone, so it asks for a code from an authenticator app on your phone." />
          <FactoryReset status={sp.linked === "1" ? "linked" : "none"} />
        </>
      ) : null}

      {view === "vrprime" ? (
        <div className="flex flex-col gap-4">
          <PageTitle title="Rajesh Industries" sub="Sends to Bhiwandi" />
          <SyncCard state={{ last_try_at: "2026-11-23T06:00:00Z", last_ok_at: "2026-11-23T06:00:00Z", last_error: null, last_products: 212 }} />
          <StockTable rows={STOCK} warehouse="Bhiwandi" canSetMin />
          <SupplierLogins
            supplierId={SUPPLIER}
            supplierName="Rajesh Industries"
            logins={[
              { id: "l1", name: "Rajesh", role: "supplier_owner", active: true, email: "rajesh@example.com" },
              { id: "l2", name: "Suresh", role: "supplier_scanner", active: true, email: "suresh@example.com" },
            ]}
          />
          <StaffLogins me="u1" logins={[{ id: "u1", name: "Aman", role: "owner", active: true }, { id: "u2", name: "Jigar", role: "admin", active: true }]} />
          <DispatchPanel detail={{ ...DETAIL, dispatch: { ...DETAIL.dispatch, status: "closed", closed_at: "2026-11-23T09:00:00Z" } }} who="vrprime" base="/dev/supplier" />
        </div>
      ) : null}
    </PortalShell>
  );
}
