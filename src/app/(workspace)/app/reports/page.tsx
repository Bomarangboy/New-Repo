import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Reports" };

export default async function Page() {
  await pageContext("report.view", "outcome_reporting");
  return <ComingSoon title="Reports" subtitle="Advertising spend, leads, bookings and sales." icon={BarChart3} what="Advertising performance, lead sources, conversion rates and recorded sales will appear here once your ad accounts are connected." />;
}
