import { LifeBuoy, Mail } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Help & Support" };

export default async function HelpPage() {
  await pageContext("support.request");
  return (
    <>
      <PageHeader title="Help & Support" subtitle="How to reach Bluewater Collective." />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Contact support">
          <p className="flex items-start gap-3 text-sm text-muted"><Mail className="mt-0.5 size-5 text-brand-500" /> In-app support requests with ticket references are coming soon. Until then, contact Bluewater using the details in your service agreement.</p>
        </Card>
        <Card title="Urgent: stop all messages">
          <p className="flex items-start gap-3 text-sm text-muted"><LifeBuoy className="mt-0.5 size-5 text-brand-500" /> If messages are going out that shouldn&apos;t, contact Bluewater immediately. An emergency pause control will be available here once messaging is live.</p>
        </Card>
      </div>
      <Card title="How numbers are calculated" className="mt-6">
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium">Periods</dt><dd className="text-muted">“Last 30 days” runs from midnight at the start of the first day until now, in your company&apos;s timezone (Settings). The previous period is the same number of days just before.</dd></div>
          <div><dt className="font-medium">New inquiries</dt><dd className="text-muted">Every inquiry submitted in the period, from all sources. A returning customer&apos;s new request counts again. Imported history counts on its original date.</dd></div>
          <div><dt className="font-medium">Lead sources</dt><dd className="text-muted">The same inquiries grouped by where they came from; the parts always add up to the total.</dd></div>
          <div><dt className="font-medium">Pipeline</dt><dd className="text-muted">Where the inquiries received in the period are now (New, Contacted, Booked, Won, Lost).</dd></div>
          <div><dt className="font-medium">Recorded sales</dt><dd className="text-muted">Sale values you entered on leads marked Won during the period. If a won lead has no value, we tell you the total is incomplete. This is not the same as revenue caused by advertising.</dd></div>
          <div><dt className="font-medium">“No data yet”</dt><dd className="text-muted">We show this — never a zero — when a number can&apos;t be calculated yet, for example before automatic replies are set up.</dd></div>
          <div><dt className="font-medium">Ad tracking</dt><dd className="text-muted">A lead shows campaign details only when they arrived with the inquiry. Many inquiries can&apos;t be linked to a specific ad; that&apos;s normal.</dd></div>
        </dl>
      </Card>
    </>
  );
}
