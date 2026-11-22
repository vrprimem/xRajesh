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

In the SQL Editor, run these three files from `supabase/migrations`, in this order, each as its own query
(open the file, copy all of it, paste, Run). Each should end with "Success".

1. `20261123100000_core.sql`
2. `20261123101000_vrprime_stock.sql`
3. `20261123102000_supplier_portal.sql`

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

## 5. Deploy the two functions

Edge Functions > Deploy a new function > Via Editor, twice:

| Name | Paste the code from | Verify JWT |
|---|---|---|
| `inventory-sync` | `supabase/functions/inventory-sync/index.ts`, and add a second file `vrprime.ts` with the contents of `supabase/functions/inventory-sync/vrprime.ts` | **Off** |
| `notify` | `supabase/functions/notify/index.ts` | **Off** |

Verify JWT is off because each function checks a secret that only this database knows, and refuses everyone else.

With the Supabase CLI instead: `npx supabase functions deploy inventory-sync --no-verify-jwt --project-ref <project-ref>`
and the same for `notify`.

## 6. Add the secrets

Edge Functions > Secrets:

| Name | Value |
|---|---|
| `VRPRIME_API_USERNAME` | The inventory software login's username |
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
  10 minutes after it)
- Start a sync by hand: `select private.start_inventory_sync();`
- Run the Produce now check by hand: `select private.supplier_produce_check();`
- Function logs: Edge Functions > the function > Logs.
