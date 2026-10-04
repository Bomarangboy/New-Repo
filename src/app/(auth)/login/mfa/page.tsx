import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { safeNext } from "@/lib/safe-next";
import { currentSession, sessionAwaitingMfa } from "@/lib/authz/guard";
import { mfaAction, signOutAction } from "../../actions";

export const metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentSession()) redirect(safeNext(next));
  if (!(await sessionAwaitingMfa())) redirect("/login");
  return (
    <div>
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-500"><ShieldCheck className="size-6" /></span>
      <h1 className="text-2xl font-bold">Two-step verification</h1>
      <p className="mt-1 text-sm text-muted">Open your authenticator app and enter the 6-digit code for Bluewater Collective.</p>
      <ActionForm action={mfaAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={safeNext(next)} />
        <Field label="Verification code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        <SubmitButton className="w-full">Verify</SubmitButton>
      </ActionForm>
      <form action={signOutAction} className="mt-6 text-center">
        <button className="text-sm text-muted hover:underline">Use a different account</button>
      </form>
      <p className="mt-6 text-xs text-muted">Lost your device? Contact Bluewater support. For your security we verify your identity before removing two-step verification.</p>
    </div>
  );
}
