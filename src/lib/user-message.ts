import { ZodError } from "zod";
import { AuthzError } from "@/lib/authz/resolve";
import { UserError } from "@/lib/errors";

/** The only way errors become screen text. Unknown errors are logged (without details) and replaced. */
export function userMessage(e: unknown): string {
  if (e instanceof UserError) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Please check the information and try again.";
  if (e instanceof AuthzError) {
    switch (e.code) {
      case "read_only": return "This account is read-only right now, so changes can't be saved.";
      case "not_entitled": return "This feature isn't included in your current package.";
      case "unauthenticated": return "Your session has ended. Please sign in again.";
      default: return "You don't have permission to do that.";
    }
  }
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`[error ${ref}]`, e instanceof Error ? `${e.name}: ${e.message.slice(0, 300)}` : "unknown");
  return `Something went wrong on our side (reference ${ref}). Please try again; if it keeps happening, contact support.`;
}
