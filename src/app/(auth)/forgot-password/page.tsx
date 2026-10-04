import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new password.</p>
      <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4">
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="font-medium text-brand-600 hover:underline">Back to sign in</Link></p>
    </div>
  );
}
