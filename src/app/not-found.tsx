import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-[480px] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="t-card-title">Not found</h1>
      <p className="t-caption">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className={buttonClass("primary")}>
        Home
      </Link>
    </main>
  );
}
