// Hand-written types that mirror supabase/migrations. Keep them in step with the migrations when the schema changes.

// VRPRIME's own people. The owner also manages logins and suppliers.
export const ROLES = ["owner", "admin"] as const;
export type Role = (typeof ROLES)[number];

// Supplier logins (outsiders): the supplier's owner, and the warehouse person who only scans.
export const SUPPLIER_ROLES = ["supplier_owner", "supplier_scanner"] as const;
export type SupplierRole = (typeof SUPPLIER_ROLES)[number];

export type Profile = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
};

/** One of VRPRIME's own people, signed in. */
export type SessionUser = Profile & { email: string | null };

/** Whoever is signed in, before it is known which side they are on: VRPRIME's own people or a supplier login. */
export type AnyUser = Omit<SessionUser, "role"> & { role: Role | SupplierRole; supplier_id: string | null };

/** A supplier login inside the supplier portal. */
export type PortalUser = { id: string; name: string; email: string | null; role: SupplierRole; supplierId: string; supplierName: string };

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

export type ActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };
