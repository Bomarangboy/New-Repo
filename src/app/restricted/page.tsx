import Link from "next/link";
import { Lock } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { studioPlatform } from "@/server/studio/runtime";
import { signOutAction } from "@/app/(auth)/actions";

const REASONS: Record<string, { title: string; body: string }> = {
  forbidden: { title: "You don't have access to this", body: "Your role doesn't include this area, or you aren't a member of that company. Ask your account owner if you need access." },
  not_entitled: { title: "Not included in your package", body: "This feature is part of a higher Bluewater package. Your account owner can contact Bluewater to discuss upgrading." },
  account_restricted: { title: "This workspace isn't available", body: "The account has been closed or archived. If you think this is a mistake, contact Bluewater support." },
  read_only: { title: "This account is read-only", body: "You can view and export records, but changes are paused. Contact Bluewater for details." },
  no_company: { title: "You're not part of a company yet", body: "Ask your account owner to send you an invitation, then open the link in that email." },
};

export default async function RestrictedPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const brand = (await studioPlatform()).brand;
  const { reason } = await searchParams;
  const r = REASONS[reason ?? ""] ?? REASONS.forbidden!;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Wordmark size="md" brand={brand} />
      <div className="card mt-8 w-full max-w-md p-8">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><Lock className="size-6" /></span>
        <h1 className="text-xl font-bold">{r.title}</h1>
        <p className="mt-2 text-sm text-muted">{r.body}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {reason !== "account_restricted" && reason !== "no_company" && <Link href="/app" className="btn-primary">Back to overview</Link>}
          <form action={signOutAction}><button className="btn-secondary w-full">Sign out</button></form>
        </div>
      </div>
    </main>
  );
}
