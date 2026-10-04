import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Link incomplete</h1>
        <p className="mt-2 text-sm text-muted">Open the link from your email again, or <Link className="text-brand-600 underline" href="/forgot-password">request a new one</Link>.</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <p className="mt-1 text-sm text-muted">Use at least 12 characters. A short phrase is easier to remember and hard to guess.</p>
      <ActionForm action={resetPasswordAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        <SubmitButton className="w-full">Save new password</SubmitButton>
      </ActionForm>
    </div>
  );
}
