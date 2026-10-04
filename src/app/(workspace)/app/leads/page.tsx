import { Users } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Leads" };

export default async function Page() {
  await pageContext("lead.view", "leads");
  return <ComingSoon title="Leads" subtitle="Every inquiry, where it came from and what happened next." icon={Users} what="New inquiries from your website and ad lead forms will appear here, with contact details, source, assignment, notes and history." />;
}
