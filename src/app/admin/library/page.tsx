import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requirePlatformAdmin } from "@/lib/authz/guard";
import { PACKAGE_NAMES } from "@/lib/authz/entitlements";
import { listTemplatesAdmin } from "@/server/library/admin";
import { FORMAT } from "@/server/library/format";
import { importAction, newTemplateAction, starterAction } from "./actions";

export const metadata = { title: "Sequence Library" };
export const dynamic = "force-dynamic";

const TONES = { draft: "amber", published: "green", paused: "red", retired: "neutral" } as const;

export default async function AdminLibrary() {
  const ctx = await requirePlatformAdmin();
  const rows = await listTemplatesAdmin(ctx);
  return (
    <>
      <PageHeader title="Sequence Library" subtitle="Curated instant replies and follow-up sequences that clients can copy into their own workspace. Drafts are never visible to clients." />
      <div className="mb-6 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-muted"><tr><th className="px-4 py-3 font-medium">Template</th><th className="px-4 py-3 font-medium">Type</th><th className="px-4 py-3 font-medium">Needs</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Copies (on)</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No templates yet. Load the starter library, import a file or create one below.</td></tr>}
            {rows.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3"><Link href={`/admin/library/${t.id}`} className="font-medium hover:text-brand-600">{t.name}</Link><span className="block text-xs text-muted">{t.industry} · {t.objective}{t.category ? ` · ${t.category}` : ""}</span></td>
                <td className="px-4 py-3">{t.kind === "sequence" ? `Sequence · ${t.stepCount} steps` : "Instant reply"}</td>
                <td className="px-4 py-3">{PACKAGE_NAMES[t.requiredPackage]}</td>
                <td className="px-4 py-3"><span className="flex flex-wrap gap-1"><Badge tone={TONES[t.status as keyof typeof TONES] ?? "neutral"}>{t.status}{t.latestVersion ? ` v${t.latestVersion}` : ""}</Badge>{t.hasDraft && t.status !== "draft" && <Badge tone="amber">draft changes</Badge>}{t.recommended && <Badge tone="blue">recommended</Badge>}</span></td>
                <td className="px-4 py-3 text-right tabular-nums">{t.copies} ({t.active})</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Import a template file">
          <ActionForm action={importAction} className="space-y-3">
            <label htmlFor="file" className="label">File ({FORMAT}, .json, up to 100 KB)</label>
            <input id="file" name="file" type="file" accept="application/json,.json" className="block text-sm" />
            <label htmlFor="json" className="label">…or paste it</label>
            <textarea id="json" name="json" rows={4} className="input font-mono text-xs" placeholder='{ "format": "bluewater.library/v1", ... }' />
            <p className="text-xs text-muted">Only Bluewater&apos;s own format is supported (see docs/examples/library-sequence-example.json). Files from other tools aren&apos;t compatible as-is. Everything is checked first; if anything is wrong, nothing is saved and you get the list of problems.</p>
            <SubmitButton>Check and import as draft</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Create a new template">
          <ActionForm action={newTemplateAction} className="space-y-3">
            <Field label="Name" name="name" required minLength={3} maxLength={80} />
            <div><label htmlFor="kind" className="label">Type</label><select id="kind" name="kind" className="input"><option value="sequence">Follow-up sequence (Engage and Insight)</option><option value="acknowledgment">Instant reply (all packages)</option></select></div>
            <SubmitButton variant="secondary">Create draft</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Starter library">
          <p className="mb-3 text-sm text-muted">Five Bluewater-written templates (instant thank-you, home-services estimate follow-up, new patient follow-up, quote follow-up by email, quick check-in). Added as drafts for you to review and publish. They&apos;re labeled “unverified” until real results exist.</p>
          <ActionForm action={starterAction}><SubmitButton variant="secondary">Add starter templates</SubmitButton></ActionForm>
        </Card>
      </div>
    </>
  );
}
