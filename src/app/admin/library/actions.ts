"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { adminActionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { UserError } from "@/lib/errors";
import {
  computeEvidence, createBlankTemplate, emergencyPause, importTemplate, liftPause, loadStarterLibrary, publishEvidence, publishTemplate,
  saveTemplateDraft, setRecommended, setRetired, startDraftFromLatest,
} from "@/server/library/admin";
import { FORMAT, INTEGRATIONS } from "@/server/library/format";

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function importAction(_: FormState, fd: FormData): Promise<FormState> {
  let id: string | undefined;
  const res = await run(async () => {
    const ctx = await adminActionContext();
    const file = fd.get("file");
    const raw = file instanceof File && file.size ? await file.text() : s(fd, "json");
    if (!raw.trim()) throw new UserError("Choose a file or paste the template.");
    const r = await importTemplate(ctx, raw, await requestId());
    if (!r.id) throw new UserError(`Not imported — nothing was saved. Problems: ${r.errors.join(" · ")}`);
    id = r.id;
    return "Imported";
  });
  if (!id) return res;
  redirect(`/admin/library/${id}?imported=1`);
}

export async function newTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  let id: string | undefined;
  const res = await run(async () => {
    const ctx = await adminActionContext();
    id = await createBlankTemplate(ctx, s(fd, "kind") === "acknowledgment" ? "acknowledgment" : "sequence", s(fd, "name"), await requestId());
    return "Created";
  });
  if (!id) return res;
  redirect(`/admin/library/${id}`);
}

export async function starterAction(_: FormState, _fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const n = await loadStarterLibrary(ctx, await requestId());
    revalidatePath("/admin/library");
    return n ? `${n} starter template(s) added as drafts. Review and publish each one.` : "The starter templates are already in the library.";
  });
}

/** Builds a definition from the friendly form fields, then validates and saves it like an import. */
export async function saveDraftFormAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = s(fd, "templateId");
    const kind = s(fd, "kind");
    const base = {
      format: FORMAT, kind, name: s(fd, "name"), description: s(fd, "description"), industry: s(fd, "industry"), objective: s(fd, "objective"),
      category: s(fd, "category") || undefined, requiredPackage: s(fd, "requiredPackage"),
      requiredIntegrations: Object.keys(INTEGRATIONS).filter((k) => fd.get(`integration.${k}`) === "on"),
    };
    let def: Record<string, unknown>;
    if (kind === "sequence") {
      const steps = [];
      for (let i = 0; i < 8; i++) {
        if (!fd.has(`step.${i}.channel`) || fd.get(`step.${i}.remove`) === "on") continue;
        const sms = s(fd, `step.${i}.sms`), body = s(fd, `step.${i}.emailBody`);
        if (!sms.trim() && !body.trim()) continue; // empty spare slot
        const channel = s(fd, `step.${i}.channel`);
        steps.push({
          delayMinutes: Math.round(Number(s(fd, `step.${i}.days`) || 0) * 1440 + Number(s(fd, `step.${i}.hours`) || 0) * 60),
          channel, smsBody: channel === "email" ? null : sms, emailSubject: channel === "sms" ? null : s(fd, `step.${i}.emailSubject`), emailBody: channel === "sms" ? null : body,
        });
      }
      def = { ...base, entry: s(fd, "entry") || "manual_only", stopOnManualMessage: fd.get("stopOnManualMessage") === "on", handoffTask: fd.get("handoffTask") === "on", steps };
    } else {
      def = { ...base, acknowledgment: { ...(s(fd, "smsBody") ? { smsBody: s(fd, "smsBody") } : {}), ...(s(fd, "emailBody") ? { emailSubject: s(fd, "emailSubject"), emailBody: s(fd, "emailBody") } : {}) } };
    }
    const r = await saveTemplateDraft(ctx, id, JSON.stringify(def), Number(s(fd, "revision")), await requestId());
    revalidatePath(`/admin/library/${id}`);
    return `Draft saved and checked.${r.warnings.length ? ` Notes: ${r.warnings.join(" ")}` : ""} Clients don't see drafts.`;
  });
}

export async function saveDraftJsonAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = s(fd, "templateId");
    const r = await saveTemplateDraft(ctx, id, s(fd, "json"), Number(s(fd, "revision")), await requestId());
    revalidatePath(`/admin/library/${id}`);
    return `Draft saved and checked.${r.warnings.length ? ` Notes: ${r.warnings.join(" ")}` : ""}`;
  });
}

export async function publishTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = s(fd, "templateId");
    const v = await publishTemplate(ctx, id, s(fd, "changelog"), Number(s(fd, "revision")), await requestId());
    revalidatePath(`/admin/library/${id}`);
    return `Published version ${v}. Existing copies are unchanged; businesses with a copy see “update available” and choose.`;
  });
}

export async function startDraftAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    await startDraftFromLatest(ctx, s(fd, "templateId"));
    revalidatePath(`/admin/library/${s(fd, "templateId")}`);
    return "Draft started from the live version.";
  });
}

export async function manageTemplateAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const id = s(fd, "templateId");
    const op = s(fd, "op");
    const rid = await requestId();
    let msg = "";
    if (op === "recommend" || op === "unrecommend") { await setRecommended(ctx, id, op === "recommend", rid); msg = op === "recommend" ? "Marked as recommended." : "No longer recommended."; }
    else if (op === "retire") { await setRetired(ctx, id, true, s(fd, "reason"), rid); msg = "Retired: no new copies. Existing copies keep working."; }
    else if (op === "unretire") { await setRetired(ctx, id, false, "", rid); msg = "Available again."; }
    else if (op === "pause") { const r = await emergencyPause(ctx, id, s(fd, "reason"), Number(s(fd, "confirmedCopies")), rid); msg = `Paused. ${r.paused} running follow-up(s) paused at ${r.companies} business(es); ${r.reverted} acknowledgment(s) put back to their previous wording.`; }
    else if (op === "lift") { await liftPause(ctx, id, rid); msg = "Pause lifted for new copies. Paused follow-ups stay paused until each business resumes them."; }
    else if (op === "evidence") { const e = await computeEvidence(ctx, id, Number(s(fd, "days") || 90), rid); msg = `Computed: ${e.enrolled} people enrolled across ${e.companies} business(es) (real customers only, simulated sends excluded).`; }
    else if (op === "publish_evidence" || op === "hide_evidence") { await publishEvidence(ctx, s(fd, "evidenceId"), op === "publish_evidence", rid); msg = op === "publish_evidence" ? "Evidence shown to clients." : "Evidence hidden."; }
    else throw new UserError("Unknown action.");
    revalidatePath(`/admin/library/${id}`);
    return msg;
  });
}
