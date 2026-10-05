import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { studioPlatform } from "@/server/studio/runtime";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card } from "@/components/ui";
import { SimulationBanner } from "@/components/simulation-banner";
import { authProvider } from "@/lib/auth";
import { requireSession } from "@/lib/authz/guard";
import { changePasswordAction, signOutEverywhereAction } from "../actions";
import { MfaEnrollForm } from "./mfa-form";

export const metadata = { title: "Password & security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const brand = (await studioPlatform()).brand;
  const { required } = await searchParams;
  const { identity, user } = await requireSession();
  const enrolled = await authProvider().mfaEnrolled(identity.authUserId);
  return (
    <div className="min-h-dvh">
      <SimulationBanner />
      <header className="flex items-center justify-between border-b border-line bg-white px-4 py-3 sm:px-8">
        <Wordmark size="sm" brand={brand} />
        <Link href={user.isPlatformAdmin ? "/admin" : "/app"} className="btn-secondary"><ArrowLeft className="size-4" /> Back</Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Password &amp; security</h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
        </div>
        {required === "mfa" && !enrolled && (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Administrator accounts must use two-step verification. Turn it on below to open the administrator area.</p>
        )}
        <Card title="Two-step verification" actions={enrolled ? <Badge tone="green" dot>On</Badge> : <Badge tone="amber" dot>Off</Badge>}>
          <MfaEnrollForm enrolled={enrolled} />
        </Card>
        <Card title="Change password">
          <ActionForm action={changePasswordAction}>
            <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
            <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required hint="At least 12 characters." />
            <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Sign out everywhere">
          <p className="mb-4 text-sm text-muted">Signs this account out on every phone and computer, including this one. Use this if a device is lost or you think someone else knows your password.</p>
          <form action={signOutEverywhereAction}><button className="btn-danger">Sign out of all devices</button></form>
        </Card>
      </main>
    </div>
  );
}
