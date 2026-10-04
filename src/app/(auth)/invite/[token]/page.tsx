import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { currentSession } from "@/lib/authz/guard";
import { viewInvitation } from "@/server/invitations";
import { acceptInviteNewAccountAction, acceptInviteSignedInAction, signOutAction } from "../../actions";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await viewInvitation(token);

  if (view.state !== "open") {
    return (
      <div>
        <h1 className="text-2xl font-bold">This invitation can&apos;t be used</h1>
        <p className="mt-2 text-sm text-muted">
          {view.state === "invalid" ? "The link isn't valid. Check that you opened the full link from your email."
            : view.state === "expired" ? `The invitation to ${view.companyName} has expired.`
            : `This invitation to ${view.companyName} was already used or replaced by a newer one.`}
          {" "}Ask the person who invited you to send a new invitation.
        </p>
        <p className="mt-6"><Link href="/login" className="btn-secondary">Go to sign in</Link></p>
      </div>
    );
  }

  const s = await currentSession();
  const roleText = view.role === "owner" ? "as the account owner" : "as a team member";

  if (s) {
    const sameEmail = s.identity.email.toLowerCase() === view.email.toLowerCase();
    return (
      <div>
        <h1 className="text-2xl font-bold">Join {view.companyName}</h1>
        <p className="mt-1 text-sm text-muted">You&apos;ve been invited {roleText}.</p>
        {sameEmail ? (
          <ActionForm action={acceptInviteSignedInAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <SubmitButton className="w-full">Accept and continue</SubmitButton>
          </ActionForm>
        ) : (
          <div className="mt-6 space-y-4">
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">This invitation is for <b>{view.email}</b>, but you&apos;re signed in as {s.identity.email}.</p>
            <form action={signOutAction}><button className="btn-secondary w-full">Sign out and switch account</button></form>
          </div>
        )}
      </div>
    );
  }

  if (view.accountExists) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Join {view.companyName}</h1>
        <p className="mt-1 text-sm text-muted">You already have a Bluewater account for {view.email}. Sign in to accept this invitation {roleText}.</p>
        <p className="mt-6"><Link href={`/login?next=/invite/${token}`} className="btn-primary w-full">Sign in to accept</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Join {view.companyName}</h1>
      <p className="mt-1 text-sm text-muted">You&apos;ve been invited {roleText}. Create your account to get started.</p>
      <ActionForm action={acceptInviteNewAccountAction} className="mt-6 space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Email address" name="email_display" value={view.email} disabled />
        <Field label="Your name" name="fullName" autoComplete="name" required />
        <Field label="Create a password" name="password" type="password" autoComplete="new-password" minLength={12} required hint="At least 12 characters." />
        <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
        <SubmitButton className="w-full">Create account and join</SubmitButton>
      </ActionForm>
    </div>
  );
}
