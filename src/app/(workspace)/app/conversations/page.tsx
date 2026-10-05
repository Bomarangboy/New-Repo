import Link from "next/link";
import { Mail, MessageCircle, MessageSquare } from "lucide-react";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";
import { formatInZone } from "@/lib/timezones";
import { listConversations } from "@/server/messaging/inbox";
import { studioForCompany } from "@/server/studio/runtime";

export const metadata = { title: "Conversations" };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await pageContext("conversation.view", "inbox");
  const ui = await studioForCompany(ctx);
  const filter = (await searchParams).filter === "needs_reply" ? "needs_reply" : "all";
  const rows = await listConversations(ctx, filter);
  return (
    <>
      <PageHeader title={ui.t("page.conversations.title")} subtitle={ui.t("page.conversations.subtitle")} actions={
        <nav className="flex rounded-xl border border-line bg-white p-1" aria-label="Filter">
          {[["all", "All"], ["needs_reply", "Needs reply"]].map(([k, l]) => (
            <Link key={k} href={k === "all" ? "/app/conversations" : "/app/conversations?filter=needs_reply"} aria-current={filter === k ? "true" : undefined}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? "bg-navy-900 text-white" : "text-muted hover:text-ink"}`}>{l}</Link>
          ))}
        </nav>
      } />
      {rows.length === 0 ? (
        <EmptyState icon={MessageCircle} title={filter === "needs_reply" ? "Nothing waiting for a reply" : ui.t("empty.conversations.title")}>
          {filter === "needs_reply" ? "When a lead writes back, their conversation shows up here." : ui.t("empty.conversations.body")}
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {rows.map((r) => {
            const Icon = r.lastChannel === "email" ? Mail : MessageSquare;
            return (
              <li key={r.id}>
                <Link href={`/app/conversations/${r.id}`} className={`flex items-start gap-3 px-4 py-3 hover:bg-brand-50/40 ${r.needsReply ? "bg-brand-50/30" : ""}`}>
                  <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${r.needsReply ? "bg-brand-500" : "bg-transparent"}`} aria-label={r.needsReply ? "Needs reply" : undefined} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate ${r.needsReply ? "font-bold" : "font-semibold"}`}>{r.name || r.phone || r.email || "Unknown"}</span>
                      <span className="shrink-0 text-xs text-muted">{r.lastMessageAt ? formatInZone(r.lastMessageAt, ctx.timezone, { dateStyle: "short", timeStyle: "short" }) : ""}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-sm text-muted">
                      <Icon className="size-3.5 shrink-0" />
                      <span className="truncate">{r.lastDirection === "outbound" ? "You: " : ""}{(r.lastBody ?? "").split("\n")[0]}</span>
                    </span>
                  </span>
                  {r.needsReply && <Badge tone="blue">Needs reply</Badge>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
