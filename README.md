# VRPRIME Supplier Portal

One phone-friendly app for a supplier (Rajesh first) and for VRPRIME: the supplier's products, dispatch plans with one
barcode label per carton, scan-out on a phone as cartons are loaded, VRPRIME's stock of the supplier's products, and
"Produce now" when stock runs low.

A separate project from vrprime-hub: its own repo, its own site and its own Supabase project. It shares nothing with
the hub and reads VRPRIME's stock straight from the inventory software.

- **App**: Next.js 16 (App Router, TypeScript strict) + Tailwind CSS 4, on Vercel (Mumbai).
- **Backend**: its own Supabase project: Postgres, Auth, Storage, two Edge Functions.
- **Access control**: Row Level Security in Postgres. The app hides things; the database enforces them.

First-time setup is in [SETUP.md](SETUP.md).

## Who sees what

| Login | Sees | Can do |
|---|---|---|
| VRPRIME owner | Every supplier | Everything below, plus add suppliers and manage all logins |
| VRPRIME admin | Every supplier | Set minimums, create dispatch plans, mark dispatches received, edit products, Sync now |
| Supplier owner | Its own supplier only | Products, dispatch plans, labels, scanning, close a dispatch, answer Produce now |
| Supplier warehouse person | Its own supplier's dispatches and products | Print labels, scan, void or reprint a label, vehicle photo, close a dispatch |

A supplier reaches VRPRIME's stock only through `supplier_stock()`: its own products, at the one warehouse it sends to.
`supabase/tests/supplier_check.sql` proves all of this; run it after any change to the database.

## A dispatch, start to finish

1. The supplier owner or VRPRIME creates a plan: products, carton type (hard or 2-ply) and cartons. Exactly one label is
   issued per carton.
2. Labels print one per page, 100 x 75 mm: a solid black band for a hard carton, a dashed frame for 2-ply, a Code 128
   barcode and the same number as a QR code.
3. Each carton is scanned as it is loaded. Android Chrome reads the barcode; other phones read the QR code; the number
   can be typed. The count runs live, split by carton type.
4. Scans are kept on the phone first and sent after, so loading carries on with no signal. The same carton twice counts
   once; a void label or another dispatch's label is refused.
5. A damaged label is reprinted: the old number becomes void, the new label gets the next number.
6. Closing needs every label scanned or void, and a photo of the loaded vehicle. Closing locks the dispatch.
7. VRPRIME presses **Mark as received** when it arrives; until then its units count as "on the way".

## Stock and Produce now

- Every 30 minutes the `inventory-sync` function reads the inventory software (read only): warehouses, products (the
  master SKUs) and pieces on hand. A reply with far fewer products than last time is refused, so a bad reply never wipes
  the stock.
- VRPRIME sets a minimum per product. Ten minutes after each sync, a product whose stock + units on the way is under its
  minimum gets a request with a quantity (enough to reach twice the minimum, in full cartons), and the supplier's owners
  get a notification and a push. The supplier answers Accepted, In production or Dispatched; the request clears when
  stock is back.

## Not built yet

- Matching VRPRIME's inbound scans carton by carton, QC rejects, and the mismatch and not-received alerts. They need the
  inventory software to list its inbound scans. `supplier_cartons.inbound_status` is ready for it.
- Whether the inventory software's scanner accepts this portal's barcodes (16 digits: `9`, a 14-digit running number, a
  check digit) is still to be agreed with its developer. They are made in one place: `private.supplier_new_barcode()`.
- Purchases and budget, daily production, the supplier's own stock ledger, WhatsApp alerts.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```

`http://localhost:3000/dev/supplier` shows the screens with fake data and no login (development only).

Checks before pushing:

```bash
npm test && npx tsc --noEmit && npm run lint && npm run build
```

## Folder map

```
src/app/(auth)              login, change-password
src/app/(portal)/supplier   the supplier's screens: home, products, dispatches (labels, scan), alerts
src/app/(portal)/suppliers  VRPRIME's screens: suppliers, one supplier, its products and dispatches, logins
src/app/dev/supplier        fake-data preview (development only)
src/components/supplier     the screens' parts: label, scanner, dispatch panel, products, stock table
src/lib/supplier.ts         barcodes, the products sheet, the scan waiting list, dispatch counts (tested)
src/lib/auth.ts             who is signed in, and which side they are on
src/server/actions          server actions; every input is checked again here
supabase/migrations         the whole database: people and access, stock sync, the portal
supabase/functions          inventory-sync (reads the inventory software), notify (push)
supabase/tests              supplier_check.sql
```

## Database changes

Every change is a new file in `supabase/migrations`, applied in filename order. Do not edit one that has been applied.
After any change, run `supabase/tests/supplier_check.sql`.
