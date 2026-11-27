import assert from "node:assert/strict";
import { test } from "node:test";
import { STAFF_HOME, supplierLinks } from "./supplier-nav.ts";

test("the warehouse person has his supplies, dispatches and scanning, and nothing else", () => {
  const links = supplierLinks("supplier_scanner", 5);
  assert.deepEqual(
    links.map((l) => [l.label, l.href]),
    [
      ["Supplies", STAFF_HOME],
      ["Dispatch", "/supplier/dispatches"],
      ["Scan", "/supplier/scan"],
    ],
  );
  assert.ok(links.every((l) => !l.badge), "no alerts for him");
  const current = (path: string) => links.filter((l) => (l.pattern ? new RegExp(l.pattern).test(path) : path.startsWith(l.href))).map((l) => l.label);
  assert.deepEqual(current("/supplier/godown"), ["Supplies"]);
  assert.deepEqual(current("/supplier/dispatches"), ["Dispatch"]);
  assert.deepEqual(current("/supplier/dispatches/5f0c6b1e-0000-4000-8000-000000000001"), ["Dispatch"]);
  assert.deepEqual(current("/supplier/dispatches/5f0c6b1e-0000-4000-8000-000000000001/scan"), ["Scan"], "scanning a dispatch is Scan");
  assert.deepEqual(current("/supplier/scan"), ["Scan"]);
});

test("the owner's pages: no Production or Money (the godown enters what is made); the day book is his", () => {
  const links = supplierLinks("supplier_owner", 2);
  assert.deepEqual(
    links.map((l) => l.label),
    ["Home", "Godown", "Dispatches", "Supplies", "Day book", "Products", "Reports", "Alerts"],
  );
  assert.ok(!supplierLinks("supplier_scanner", 0).some((l) => l.href === "/supplier/daybook"), "not the warehouse person's");
  assert.equal(links.find((l) => l.label === "Alerts")?.badge, 2);
});
