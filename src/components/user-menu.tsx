import Link from "next/link";
import { LogOut, ShieldCheck, Shield } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";

function initials(name: string, email: string) {
  const src = name.trim() || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Uses <details> so it works without client-side JavaScript. */
export function UserMenu({ name, email, isAdmin }: { name: string; email: string; isAdmin: boolean }) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full p-0.5 hover:bg-white [&::-webkit-details-marker]:hidden" aria-label="Account menu">
        <span className="grid size-10 place-items-center rounded-full bg-brand-100 text-sm font-bold text-navy-900">{initials(name, email)}</span>
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-xl">
        <div className="px-3 py-2">
          <p className="truncate text-sm font-semibold">{name || email}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <Link href="/account/security" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-canvas"><ShieldCheck className="size-4" /> Password &amp; security</Link>
        {isAdmin && <Link href="/admin" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-canvas"><Shield className="size-4" /> Administrator area</Link>}
        <form action={signOutAction}>
          <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"><LogOut className="size-4" /> Sign out</button>
        </form>
      </div>
    </details>
  );
}
