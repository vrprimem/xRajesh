# Setting up the supplier portal

One time, about 30 minutes. This project has its own Supabase project, its own GitHub repo and its own Vercel site.
Nothing here touches vrprime-hub.

You need: a Supabase account, a GitHub account, a Vercel account, and a login for the inventory software
(inventory.vrprime.in), ideally a separate user made just for this.

## 1. Create the Supabase project

1. supabase.com > New project. Name it `vrprime-supplier-portal`, region **Mumbai (ap-south-1)**, and save the database
   password somewhere safe.
2. Authentication > Sign In / Providers > turn **off** "Allow new users to sign up". There is no public sign-up.
3. Project Settings > API: note the **Project URL** and the project ref (the part before `.supabase.co`).
4. Project Settings > API keys: note the **publishable** key and the **secret** key.

## 2. Create the tables

In the SQL Editor, run every file in `supabase/migrations`, in this order (the order of their names), each as its own query
(open the file, copy all of it, paste, Run). Each should end with "Success". Supabase may warn that a file creates
tables without Row Level Security or drops things: the files switch RLS on themselves and drop only their own helpers.

1. `20261123100000_core.sql`
2. `20261123101000_vrprime_stock.sql`
3. `20261123102000_supplier_portal.sql`
4. `20261123103000_inventory_labels.sql`
5. `20261123104000_carton_weight.sql`
6. `20261123105000_dispatch_due.sql`
7. `20261123106000_send_plans.sql`
8. `20261123107000_factory_reset.sql`
9. `20261123108000_factory_reset_authenticator.sql`
10. `20261123109000_factory_reset_where.sql`
11. `20261123110000_master_sku_search.sql`
12. `20261123111000_supplier_supplies_money.sql`
13. `20261123112000_supplier_production.sql`

Then tell the database where its functions live. Run this with your own project ref in place of `<project-ref>`:

```sql
update private.internal_config set value = 'https://<project-ref>.supabase.co/functions/v1' where key = 'functions_url';
```

## 3. Create your own login (the owner)

Authentication > Users > Add user > Create new user. Enter your email and a password, tick "Auto Confirm User".
The first user ever created becomes the owner automatically. This happens once.

## 4. Check the access rules

In the SQL Editor run `supabase/tests/supplier_check.sql`. It makes fake users, tests every rule and rolls itself back.
Expect one row: `All supplier portal checks passed`. If it shows an error instead, stop and fix that first.

## 5. Deploy the three functions

Edge Functions > Deploy a new function > Via Editor, three times:

| Name | Paste the code from | Verify JWT |
|---|---|---|
| `inventory-sync` | `supabase/functions/inventory-sync/index.ts`, and add a second file `vrprime.ts` with the contents of `supabase/functions/inventory-sync/vrprime.ts` | **Off** |
| `carton-labels` | `supabase/functions/carton-labels/index.ts`, and add a second file `labels-api.ts` with the contents of `supabase/functions/carton-labels/labels-api.ts` | **Off** |
| `notify` | `supabase/functions/notify/index.ts` | **Off** |

Verify JWT is off because each function checks a secret that only this database knows, and refuses everyone else.

With the Supabase CLI instead: `npx supabase functions deploy inventory-sync --no-verify-jwt --project-ref <project-ref>`
and the same for `notify`.

## 6. Add the secrets

Edge Functions > Secrets:

| Name | Value |
|---|---|
| `VRPRIME_API_USERNAME` | The inventory software login's username. This login must be allowed to print carton labels. |
| `VRPRIME_API_PASSWORD` | Its password |
| `VAPID_PUBLIC_KEY` | From the command below |
| `VAPID_PRIVATE_KEY` | From the command below. Never put this anywhere else. |
| `VAPID_SUBJECT` | Optional: `mailto:` and your email |

Make the push key pair on any computer: `npx web-push generate-vapid-keys`. It prints a public and a private key.

## 7. Put the site online

1. Push this folder to a new, empty GitHub repo.
2. vercel.com > Add New > Project > import that repo.
3. Environment Variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Project URL from step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key |
| `SUPABASE_SECRET_KEY` | The secret key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | The VAPID public key from step 6 |

4. Deploy. Optionally add a domain such as `supplier.vrprime.in` under Settings > Domains.

## 8. First use

1. Open the site and sign in with the login from step 3.
2. Press **Sync now**. After a few seconds the card should say "Working" and show a product count. This brings in the
   warehouses and the master SKUs. If it says "Last sync failed", the message says why (usually the username or password).
3. **Add supplier**: the name, and Bhiwandi as the warehouse it sends to.
4. Open the supplier > **Products** > Import sheet (or add by hand). Give each product its master SKU code, exactly as
   the inventory software has it: stock shows only for products that have one.
5. Back on the supplier's page, type a **minimum** for each product and press Save.
6. **Add login**: "Supplier owner" for the owner, "Warehouse person" for whoever scans. Press Generate, and send each
   person their email and temporary password. They choose their own password the first time they sign in.
7. Each of them opens the site on their phone, signs in, opens **Alerts** and turns notifications on. On an iPhone this
   works only after the site is added to the Home Screen (Share > Add to Home Screen) and opened from there.

## 9. A trial dispatch

Before a real one: create a dispatch of 3 or 4 cartons, print the labels, scan them on the warehouse phone, add a vehicle
photo and close it. Then sign in as yourself, open the dispatch and press **Mark as received**. This shows whether the
labels fit the printer (100 x 75 mm, one per page; the size is set in `src/components/supplier/label.tsx`) and whether
the phone reads them.

## Checking things later

- Stock sync state: `select * from inventory_sync_state;`
- Scheduled jobs: `select jobname, schedule from cron.job;` (`inventory-sync` every 30 minutes, `supplier-produce-check`
  10 minutes after it, `supplier-receive-check` 15 minutes after it)
- A dispatch whose labels stopped: `select number, labels_error from supplier_dispatches where labels_error is not null;`
- Start a sync by hand: `select private.start_inventory_sync();`
- Run the Produce now check by hand: `select private.supplier_produce_check();`
- Function logs: Edge Functions > the function > Logs.

## Supplies, production and money

The supplier enters its supplies (bottles, triggers, chemicals, cartons), what it buys and pays its vendors, labour,
hamali and other costs, and what it makes each day. Who sees what is fixed in the database, not only in the app:

- Money (vendors, purchases, payments, costs, cost per unit): the supplier's owner login only. Not its warehouse person,
  not VRPRIME's owner or admin.
- Supplies and their stock, recipes, production, ready stock and when send plans can be ready: the supplier's logins
  and VRPRIME's owner and admin (VRPRIME: supplier page > Production). None of it carries a price.
- `supabase/tests/supplier_check.sql` (section 7) proves both.

## Factory reset

The owner can wipe the portal from VRPRIME logins > Factory reset: either the test activity only, or everything except
VRPRIME's own logins. Nothing in the inventory software is touched. It asks for the code of an authenticator app
(Google or Microsoft Authenticator) that the owner links once on that page, after entering their password again.

- A linked app cannot be swapped from the portal (so nobody who learns the password can link their own phone). If the
  owner's phone is lost or replaced, remove the link in the SQL editor, then link the new phone on the reset page:
  `delete from private.reset_authenticators;`
- Who reset what, and when (kept through every reset): `select * from private.factory_resets order by id desc;`
- Prove the locks on a fresh copy or locally (it refuses to run where there are suppliers, so never on the live portal):
  `supabase/tests/reset_check.sql`
