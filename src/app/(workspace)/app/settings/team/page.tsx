import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { roleCan } from "@/lib/authz/permissions";
import { formatInZone } from "@/lib/timezones";
import { listTeam } from "@/server/team";
import { listPendingInvitations } from "@/server/invitations";
import { inviteEmployeeAction, removeMemberAction, revokeInvitationAction, transferOwnershipAction } from "../../actions";

export const metadata = { title: "Team" };

const NOTICES: Record<string, string> = {
  member_removed: "Team member removed. Their access ended immediately.",
  invite_cancelled: "Invitation cancelled. The link no longer works.",
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const ctx = await pageContext("team.view");
  const notice = NOTICES[(await searchParams).notice ?? ""];
  const team = await listTeam(ctx);
  const canManage = roleCan(ctx.role, "team.invite") && ctx.policy.login === "full";
  const pending = canManage ? await listPendingInvitations(ctx) : [];
  const employees = team.filter((m) => m.role === "employee");

  return (
    <>
      <PageHeader title="Team" subtitle="People who can sign in to this workspace." />
      {notice && <p role="status" className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={`Members (${team.length})`}>
          <ul className="divide-y divide-line">
            {team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.fullName || m.email}</p>
                  <p className="truncate text-sm text-muted">{m.email}</p>
                </div>
                <Badge tone={m.role === "owner" ? "blue" : "neutral"}>{m.role === "owner" ? "Owner" : "Employee"}</Badge>
                {canManage && m.role === "employee" && (
                  <ActionForm action={removeMemberAction} className="flex flex-col items-end gap-1">
                    <input type="hidden" name="userId" value={m.userId} />
                    <SubmitButton variant="secondary" className="px-3 py-1.5 text-xs">Remove</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {canManage && (
          <div className="space-y-6">
            <Card title="Invite a team member">
              <ActionForm action={inviteEmployeeAction}>
                <Field label="Email address" name="email" type="email" required placeholder="name@yourbusiness.com" />
                <p className="text-xs text-muted">They&apos;ll get an email with a link to create their account. Employees can work leads and conversations; they can&apos;t change settings, invite others or export data.</p>
                <SubmitButton>Send invitation</SubmitButton>
              </ActionForm>
              {pending.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 text-sm font-semibold">Pending invitations</h3>
                  <ul className="divide-y divide-line">
                    {pending.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{p.email}<span className="block text-xs text-muted">Expires {formatInZone(p.expiresAt, ctx.timezone, { dateStyle: "medium" })}</span></span>
                        <ActionForm action={revokeInvitationAction} className="flex flex-col items-end gap-1">
                          <input type="hidden" name="invitationId" value={p.id} />
                          <SubmitButton variant="secondary" className="px-3 py-1.5 text-xs">Cancel</SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {ctx.role === "owner" && employees.length > 0 && (
              <Card title="Transfer ownership">
                <ActionForm action={transferOwnershipAction}>
                  <p className="text-sm text-muted">The new owner gets full control, including billing and data export. You&apos;ll become an employee. For security, you must have signed in within the last 15 minutes.</p>
                  <div>
                    <label htmlFor="userId" className="label">New owner</label>
                    <select id="userId" name="userId" className="input" required>
                      {employees.map((e) => <option key={e.userId} value={e.userId}>{e.fullName || e.email}</option>)}
                    </select>
                  </div>
                  <Field label={`Type "${ctx.companyName}" to confirm`} name="confirmName" required autoComplete="off" />
                  <SubmitButton variant="danger">Transfer ownership</SubmitButton>
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
