import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { getImport, recentImports, MAX_IMPORT_ROWS, type ImportRow } from "@/server/crm/imports";
import { cancelImportAction, commitImportAction, previewImportAction } from "../actions";

export const metadata = { title: "Import leads" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ batch?: string; done?: string; created?: string; skipped?: string; matched?: string }> }) {
  const ctx = await pageContext("lead.import", "leads");
  const sp = await searchParams;
  const batch = sp.batch ? await getImport(ctx, sp.batch) : null;
  const history = await recentImports(ctx);

  return (
    <>
      <Link href="/app/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Leads</Link>
      <PageHeader title="Import leads" subtitle="Bring in past inquiries from a spreadsheet. Imported leads never receive automatic messages." />

      {sp.done && (
        <p className="mb-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Import complete: {sp.created} added{Number(sp.matched) > 0 ? ` (${sp.matched} matched existing contacts)` : ""}{Number(sp.skipped) > 0 ? `, ${sp.skipped} skipped because they were already imported` : ""}.
        </p>
      )}

      {batch && batch.status === "previewed" ? (
        <Card title={`Check before importing: ${batch.fileName}`}>
          <div className="mb-4 flex flex-wrap gap-2">
            <Badge tone="green">{`${batch.validRows} ready to import`}</Badge>
            {batch.errors.length > 0 && <Badge tone="amber">{`${batch.errors.length} rows with problems (will be skipped)`}</Badge>}
            <Badge>{`${batch.totalRows} rows in file`}</Badge>
          </div>
          {batch.errors.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold">Rows that won&apos;t be imported</h3>
              <ul className="max-h-64 space-y-1 overflow-auto rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                {batch.errors.slice(0, 200).map((e) => <li key={e.row}><b>Row {e.row}:</b> {e.problems.join(" ")}</li>)}
              </ul>
              <p className="mt-1 text-xs text-muted">Row numbers match your spreadsheet (row 1 is the column headings). Fix them and import the file again — rows already imported are skipped automatically.</p>
            </div>
          )}
          {batch.validRows > 0 && (
            <div className="mb-5 overflow-x-auto">
              <h3 className="mb-2 text-sm font-semibold">First rows</h3>
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Row</th><th className="py-1 pr-3 font-medium">Name</th><th className="py-1 pr-3 font-medium">Email</th><th className="py-1 pr-3 font-medium">Phone</th><th className="py-1 pr-3 font-medium">Service</th><th className="py-1 font-medium">Date</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {(batch.rows as ImportRow[]).slice(0, 8).map((r) => (
                    <tr key={r.row}><td className="py-1.5 pr-3 text-muted">{r.row}</td><td className="py-1.5 pr-3">{r.fullName || "—"}</td><td className="py-1.5 pr-3">{r.email ?? "—"}</td><td className="py-1.5 pr-3">{r.phone ?? "—"}</td><td className="py-1.5 pr-3">{r.serviceRequested ?? "—"}</td><td className="py-1.5">{r.submittedAt ? r.submittedAt.slice(0, 10) : "today"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {batch.validRows > 0 && (
              <ActionForm action={commitImportAction} className="flex flex-col gap-2">
                <input type="hidden" name="batchId" value={batch.id} />
                <SubmitButton>Import {batch.validRows} leads</SubmitButton>
              </ActionForm>
            )}
            <form action={cancelImportAction}><input type="hidden" name="batchId" value={batch.id} /><button className="btn-secondary">Cancel</button></form>
          </div>
        </Card>
      ) : (
        <Card title="Upload a spreadsheet">
          <ActionForm action={previewImportAction}>
            <div className="rounded-2xl border-2 border-dashed border-line p-6 text-center">
              <FileSpreadsheet className="mx-auto mb-2 size-8 text-brand-500" />
              <label htmlFor="file" className="label">Choose a CSV file</label>
              <input id="file" name="file" type="file" accept=".csv,text/csv" required className="mx-auto block text-sm" />
            </div>
            <div className="text-sm text-muted">
              <p className="font-medium text-ink">What the file should look like</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>First row = column headings. Needs an <b>Email</b> or <b>Phone</b> column (or both).</li>
                <li>Optional: Name (or First name + Last name), Service, Message, Date (2026-03-31 or 3/31/2026), utm_source, utm_campaign.</li>
                <li>Up to {MAX_IMPORT_ROWS.toLocaleString("en-US")} rows / 2 MB. From Excel or Google Sheets: File → Download → CSV.</li>
                <li>You&apos;ll see every problem before anything is added.</li>
              </ul>
            </div>
            <SubmitButton>Check file</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {history.length > 0 && (
        <Card title="Recent imports" className="mt-6">
          <ul className="divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{h.fileName}<span className="block text-xs text-muted">{formatInZone(h.createdAt, ctx.timezone)}</span></span>
                <span className="text-muted">{h.status === "committed" ? `${h.createdCount} added` : h.status === "previewed" ? <Link className="text-brand-600 hover:underline" href={`/app/leads/import?batch=${h.id}`}>Waiting for confirmation</Link> : "Cancelled"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
