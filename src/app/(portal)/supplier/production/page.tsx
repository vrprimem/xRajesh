import { redirect } from "next/navigation";

/** Production is entered at the godown now ("Made today"), and recipes are on Products: old links go to the godown. */
export default function SupplierProductionPage() {
  redirect("/supplier/godown");
}
