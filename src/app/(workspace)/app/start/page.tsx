import { redirect } from "next/navigation";
import { pageContext } from "@/lib/authz/guard";
import { studioForCompany } from "@/server/studio/runtime";

/** After sign-in: go to the page chosen in Platform Studio for this package/company (only if this person may open it). */
export default async function StartPage() {
  const ctx = await pageContext("workspace.view");
  const ui = await studioForCompany(ctx);
  redirect(ui.landing(ctx.role, ctx.package));
}
