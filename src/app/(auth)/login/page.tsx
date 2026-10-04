import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { safeNext } from "@/lib/safe-next";
import { currentSession } from "@/lib/authz/guard";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const s = await currentSession();
  if (s) redirect(safeNext(sp.next));
  return (
    <div>
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back. Sign in to your company workspace.</p>
      {sp.reset && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Your password was changed. Sign in with the new one.</p>}
      <ActionForm action={signInAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeNext(sp.next)} />
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <div className="flex items-center justify-between">
          <Link href="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">Forgot your password?</Link>
        </div>
        <SubmitButton className="w-full">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-8 text-center text-xs text-muted">Accounts are created by invitation. Ask your account owner for an invite.</p>
    </div>
  );
}
