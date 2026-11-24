import { redirect } from "next/navigation";

/** Money is not part of the supplier's portal any more: old links go to the godown. */
export default function SupplierMoneyPage() {
  redirect("/supplier/godown");
}
