import { Zap } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Automations" };

export default async function Page() {
  await pageContext("template.view", "acknowledgment");
  return <ComingSoon title="Automations" subtitle="The messages Bluewater sends for you, and when." icon={Zap} what="Your acknowledgment message, team notifications and (Package 2) follow-up sequences will be managed here." />;
}
