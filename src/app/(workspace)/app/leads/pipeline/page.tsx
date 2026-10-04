import Link from "next/link";
import { ArrowLeft, List } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { STAGE_TONES, money } from "@/components/lead-bits";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { pipelineBoard, STAGES, STAGE_LABELS } from "@/server/crm/leads";

export const metadata = { title: "Pipeline" };

const BAR = { blue: "bg-brand-500", amber: "bg-amber-500", purple: "bg-violet-500", green: "bg-emerald-500", neutral: "bg-slate-400" } as const;

export default async function PipelinePage() {
  const ctx = await pageContext("lead.view", "pipeline_board");
  const board = await pipelineBoard(ctx);
  return (
    <>
      <Link href="/app/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" /> Leads</Link>
      <PageHeader title="Pipeline" subtitle="New → Contacted → Booked → Won / Lost. Open a lead to move it." actions={<Link href="/app/leads" className="btn-secondary"><List className="size-4" /> List view</Link>} />
      <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {STAGES.map((s) => (
          <section key={s} className="w-72 shrink-0 snap-start rounded-2xl bg-white/60 p-3 ring-1 ring-line" aria-label={STAGE_LABELS[s]}>
            <header className="mb-3 flex items-center gap-2 px-1">
              <span className={`size-2.5 rounded-full ${BAR[STAGE_TONES[s]]}`} />
              <h2 className="font-semibold">{STAGE_LABELS[s]}</h2>
              <span className="ml-auto rounded-full bg-canvas px-2 py-0.5 text-xs font-semibold tabular-nums">{board[s].total}</span>
            </header>
            <ul className="space-y-2">
              {board[s].items.map((i) => (
                <li key={i.id}>
                  <Link href={`/app/leads/${i.id}`} className="card block p-3 hover:border-brand-200">
                    <p className="truncate font-medium">{i.name}</p>
                    <p className="truncate text-xs text-muted">{i.service ?? "No service listed"}</p>
                    <p className="mt-1 flex justify-between text-xs text-muted"><span>{formatInZone(i.submittedAt, ctx.timezone, { dateStyle: "medium" })}</span>{s === "won" && <span className="font-semibold text-ink">{money(i.saleValueCents)}</span>}</p>
                  </Link>
                </li>
              ))}
              {board[s].total > board[s].items.length && (
                <li><Link href={`/app/leads?stage=${s}`} className="block px-1 text-sm text-brand-600 hover:underline">View all {board[s].total}</Link></li>
              )}
              {board[s].total === 0 && <li className="px-1 py-4 text-center text-sm text-muted">Nothing here</li>}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
