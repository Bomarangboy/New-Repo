import { MessageCircle } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { pageContext } from "@/lib/authz/guard";

export const metadata = { title: "Conversations" };

export default async function Page() {
  await pageContext("conversation.view", "inbox");
  return <ComingSoon title="Conversations" subtitle="Texts and emails with your leads, in one inbox." icon={MessageCircle} what="Two-way text and email conversations with each lead will appear here, including automatic acknowledgments and replies." />;
}
