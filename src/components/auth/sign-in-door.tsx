import Link from "next/link";
import { LoginForm } from "@/components/auth/auth-forms";
import { ShieldIcon, TruckIcon } from "@/components/icons";
import { DOOR_PATH, type Door } from "@/lib/doors";

const DOORS: { door: Door; tab: string; title: string; sub: string; Icon: typeof TruckIcon }[] = [
  { door: "supplier", tab: "Supplier", title: "Supplier sign in", sub: "For the supplier and their team: dispatches, labels and stock.", Icon: TruckIcon },
  { door: "admin", tab: "VRPRIME admin", title: "Admin sign in", sub: "For VRPRIME's own people: suppliers, send plans and minimums.", Icon: ShieldIcon },
];

/**
 * A sign-in page: the switch between the two doors (each is its own page, so either can be bookmarked), the door's
 * title, and the form. Each door lets in only its own kind of account.
 */
export function SignInDoor({ door, notice }: { door: Door; notice?: string }) {
  const here = DOORS.find((d) => d.door === door) ?? DOORS[0];
  return (
    <>
      <nav aria-label="Who is signing in" className="vr-doors mb-5">
        {DOORS.map(({ door: d, tab, Icon }) => (
          <Link key={d} href={DOOR_PATH[d]} replace aria-current={d === door ? "page" : undefined} className="focus-ring">
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {tab}
          </Link>
        ))}
      </nav>
      <h1 className="t-card-title">{here.title}</h1>
      <p className="t-caption g-head mt-0.5">{here.sub}</p>
      <LoginForm key={door} door={door} notice={notice} />
    </>
  );
}
