import { redirect } from "next/navigation";
import { currentSession } from "@/lib/authz/guard";

export default async function Home() {
  const s = await currentSession();
  redirect(s ? "/app" : "/login");
}
