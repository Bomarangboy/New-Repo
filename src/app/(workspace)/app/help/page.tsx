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
    </>
  );
}
