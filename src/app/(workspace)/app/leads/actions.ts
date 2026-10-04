"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import { UserError } from "@/lib/errors";
import type { FormState } from "@/components/forms";
import {
  addNote, addTask, assignLead, changeStage, createLeadManually, recordSale, setTaskDone, updateContactDetails, STAGES, type Stage,
} from "@/server/crm/leads";
import { cancelImport, commitImport, MAX_IMPORT_BYTES, previewImport } from "@/server/crm/imports";

async function run(fn: () => Promise<string>, revalidate?: string): Promise<FormState> {
  try {
    const ok = await fn();
    if (revalidate) revalidatePath(revalidate);
    return { ok };
  } catch (e) {
    return { error: userMessage(e) };
  }
}
const id = (fd: FormData, k = "inquiryId") => String(fd.get(k) ?? "");

export async function createLeadAction(_: FormState, fd: FormData): Promise<FormState> {
  let newId = "";
  const res = await run(async () => {
    const ctx = await actionContext("lead.create", "leads");
    const r = await createLeadManually(ctx, {
      fullName: String(fd.get("fullName") ?? ""), email: String(fd.get("email") ?? ""), phone: String(fd.get("phone") ?? ""),
      serviceRequested: String(fd.get("serviceRequested") ?? ""), message: String(fd.get("message") ?? ""),
      assignToUserId: String(fd.get("assignTo") ?? "") || null,
    });
    newId = r.inquiry.id;
    return "ok";
  });
  if (res?.error) return res;
  redirect(`/app/leads/${newId}?created=1`);
}

export async function updateContactAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.edit", "leads");
    await updateContactDetails(ctx, id(fd), { fullName: String(fd.get("fullName") ?? ""), email: String(fd.get("email") ?? ""), phone: String(fd.get("phone") ?? "") });
    return "Contact details saved.";
  }, `/app/leads/${id(fd)}`);
}

export async function changeStageAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.edit", "leads");
    const stage = String(fd.get("stage")) as Stage;
    if (!STAGES.includes(stage)) throw new Error("bad stage");
    await changeStage(ctx, id(fd), stage, { lostReason: String(fd.get("lostReason") ?? "") });
    return "Stage updated.";
  }, `/app/leads/${id(fd)}`);
}

export async function recordSaleAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.edit", "leads");
    const amount = String(fd.get("amount") ?? "");
    await recordSale(ctx, id(fd), amount);
    return amount.trim() ? "Sale recorded and lead marked Won." : "Sale value cleared.";
  }, `/app/leads/${id(fd)}`);
}

export async function assignAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.assign", "leads");
    await assignLead(ctx, id(fd), String(fd.get("userId") ?? "") || null);
    return "Assignment saved.";
  }, `/app/leads/${id(fd)}`);
}

export async function addNoteAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.edit", "leads");
    await addNote(ctx, id(fd), String(fd.get("body") ?? ""));
    return "Note added.";
  }, `/app/leads/${id(fd)}`);
}

export async function addTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await actionContext("lead.edit", "tasks");
    const due = String(fd.get("dueAt") ?? "");
    await addTask(ctx, id(fd), {
      title: String(fd.get("title") ?? ""), dueAt: due ? new Date(`${due}T12:00:00Z`) : null, assignedUserId: String(fd.get("assignTo") ?? "") || null,
    });
    return "Task added.";
  }, `/app/leads/${id(fd)}`);
}

export async function toggleTaskAction(fd: FormData): Promise<void> {
  const ctx = await actionContext("lead.edit", "tasks");
  await setTaskDone(ctx, String(fd.get("taskId")), fd.get("done") === "1");
  revalidatePath(`/app/leads/${id(fd)}`);
}

export async function previewImportAction(_: FormState, fd: FormData): Promise<FormState> {
  let batchId = "";
  const res = await run(async () => {
    const ctx = await actionContext("lead.import", "leads");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose a CSV file to upload.");
    if (file.size > MAX_IMPORT_BYTES) throw new UserError("The file is larger than 2 MB. Split it into smaller files.");
    if (!/\.csv$/i.test(file.name) && !file.type.includes("csv") && file.type !== "text/plain") throw new UserError("Upload a .csv file (in Excel or Google Sheets: File → Download → CSV).");
    const b = await previewImport(ctx, file.name, await file.text());
    batchId = b.id;
    return "ok";
  });
  if (res?.error) return res;
  redirect(`/app/leads/import?batch=${batchId}`);
}

export async function commitImportAction(_: FormState, fd: FormData): Promise<FormState> {
  let summary = "";
  const res = await run(async () => {
    const ctx = await actionContext("lead.import", "leads");
    const r = await commitImport(ctx, id(fd, "batchId"), await requestId());
    summary = `created=${r.created}&skipped=${r.skipped}&matched=${r.matched}`;
    return "ok";
  });
  if (res?.error) return res;
  redirect(`/app/leads/import?done=1&${summary}`);
}

export async function cancelImportAction(fd: FormData): Promise<void> {
  const ctx = await actionContext("lead.import", "leads");
  await cancelImport(ctx, id(fd, "batchId"));
  redirect("/app/leads/import");
}
