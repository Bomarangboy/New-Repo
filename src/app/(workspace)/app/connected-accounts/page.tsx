import { Link2 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Connected Accounts" };

export default async function Page() {
  await pageContext("integration.view", "lead_sources");
  return <ComingSoon title="Connected Accounts" subtitle="Lead sources, advertising accounts and tools linked to Bluewater." icon={Link2} what="Your website form, Meta (Facebook & Instagram) and Google Ads connections will be managed here. Bluewater never asks for your account passwords." />;
}
