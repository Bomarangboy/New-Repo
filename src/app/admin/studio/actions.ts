"use server";

import { revalidatePath } from "next/cache";
import { adminActionContext, requestId } from "@/lib/authz/guard";
import { userMessage } from "@/lib/user-message";
import type { FormState } from "@/components/forms";
import { UserError } from "@/lib/errors";
import { discardDraft, loadScope, publishScope, restoreVersion, saveDraft, uploadAsset } from "@/server/studio/service";
import { DASHBOARD_CARDS, NAV_ITEMS, SETTINGS, sameValue, type CardLayout, type Flat } from "@/server/studio/registry";
import type { ImageKind } from "@/server/studio/images";

async function run(fn: () => Promise<string>): Promise<FormState> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: userMessage(e) };
  }
}

const SECTION_PREFIX: Record<string, string[]> = {
  brand: ["brand."], content: ["text."], packages: ["package."], navigation: ["nav."], dashboard: ["dashboard."],
};

function move<T>(list: T[], index: number, dir: string): T[] {
  const to = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}

/**
 * Saves one editor section into the DRAFT. A value equal to what this scope would inherit anyway is stored as
 * "no override" (so later default changes still reach it); anything different becomes an override.
 */
export async function saveSectionAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const scope = String(fd.get("scope") ?? "");
    const revision = Number(fd.get("revision") ?? -1);
    const section = String(fd.get("section") ?? "");
    const prefixes = SECTION_PREFIX[section];
    if (!prefixes) throw new UserError("Unknown section.");
    const data = await loadScope(ctx, scope);
    const inherited = data.inherited.values;
    const effective = data.effective.values;

    const reset = String(fd.get("resetKey") ?? "");
    if (reset) {
      if (!(reset in SETTINGS)) throw new UserError("Unknown setting.");
      await saveDraft(ctx, scope, { set: {}, unset: [reset] }, revision, await requestId());
      return `“${SETTINGS[reset]!.label}” now follows ${data.inherited.source[reset] ?? "the default"} again (draft — not live until you publish).`;
    }

    const proposed: Flat = {};
    const keys = Object.keys(SETTINGS).filter((k) => prefixes.some((p) => k.startsWith(p)) && SETTINGS[k]!.scopes.includes(data.scope.kind));
    const mv = String(fd.get("move") ?? "");
    for (const k of keys) {
      const def = SETTINGS[k]!;
      if (def.type === "text" || def.type === "color" || def.type === "font" || def.type === "asset" || def.type === "landing") {
        if (fd.has(k)) proposed[k] = String(fd.get(k) ?? "");
      }
    }
    if (section === "navigation") {
      let order = [...(effective["nav.order"] as string[])];
      const [kind, id, dir] = mv.split(":");
      if (kind === "nav" && id && dir) order = move(order, order.indexOf(id), dir);
      proposed["nav.order"] = order;
      proposed["nav.hidden"] = NAV_ITEMS.filter((n) => fd.get(`hide.${n.id}`) === "on").map((n) => n.id);
    }
    if (section === "dashboard") {
      proposed["dashboard.tiles"] = [0, 1, 2, 3].map((i) => String(fd.get(`tile.${i}`) ?? "")).filter(Boolean);
      let cards: CardLayout[] = (effective["dashboard.cards"] as CardLayout[]).map((c) => ({
        id: c.id, visible: fd.get(`card.visible.${c.id}`) === "on", size: (String(fd.get(`card.size.${c.id}`) ?? c.size) as CardLayout["size"]),
      }));
      const [kind, id, dir] = mv.split(":");
      if (kind === "card" && id && dir && id in DASHBOARD_CARDS) cards = move(cards, cards.findIndex((c) => c.id === id), dir);
      proposed["dashboard.cards"] = cards;
    }

    const set: Flat = {}, unset: string[] = [];
    for (const [k, v] of Object.entries(proposed)) {
      const val = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v;
      const same = typeof val === "string" && typeof inherited[k] === "string" ? val === String(inherited[k]).trim() : sameValue(val, inherited[k]);
      if (same) { if (k in data.draft) unset.push(k); }
      else if (!sameValue(val, data.draft[k])) set[k] = val;
    }
    if (!Object.keys(set).length && !unset.length) return "No changes to save.";
    const r = await saveDraft(ctx, scope, { set, unset }, revision, await requestId());
    revalidatePath("/admin/studio/edit");
    return `Draft saved (${Object.keys(set).length + unset.length} change${Object.keys(set).length + unset.length === 1 ? "" : "s"}). Nothing is live until you publish.${r.warnings.length ? " Note: " + r.warnings.join(" ") : ""}`;
  });
}

export async function uploadImageAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const scope = String(fd.get("scope") ?? "");
    const key = String(fd.get("key") ?? "");
    const def = SETTINGS[key];
    if (!def || def.type !== "asset") throw new UserError("Unknown image setting.");
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new UserError("Choose an image file first.");
    const id = await uploadAsset(ctx, def.assetKind as ImageKind, Buffer.from(await file.arrayBuffer()), await requestId());
    await saveDraft(ctx, scope, { set: { [key]: id }, unset: [] }, Number(fd.get("revision") ?? -1), await requestId());
    revalidatePath("/admin/studio/edit");
    return "Image checked and added to the draft. Preview it, then publish.";
  });
}

export async function publishAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const r = await publishScope(ctx, String(fd.get("scope") ?? ""), Number(fd.get("revision") ?? -1), String(fd.get("summary") ?? ""), await requestId());
    revalidatePath("/", "layout");
    return `Published as version ${r.version} (${r.changes.length} setting${r.changes.length === 1 ? "" : "s"} changed). Everyone sees it on their next page load.`;
  });
}

export async function discardAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    await discardDraft(ctx, String(fd.get("scope") ?? ""), Number(fd.get("revision") ?? -1), await requestId());
    revalidatePath("/admin/studio/edit");
    return "Draft discarded — it matches what is live again.";
  });
}

export async function restoreAction(_: FormState, fd: FormData): Promise<FormState> {
  return run(async () => {
    const ctx = await adminActionContext();
    const r = await restoreVersion(ctx, String(fd.get("scope") ?? ""), Number(fd.get("version") ?? 0), Number(fd.get("revision") ?? -1), await requestId());
    revalidatePath("/admin/studio/edit");
    return `Version copied into the draft. Preview it, then publish to make it live.${r.dropped.length ? ` Not restored (no longer supported or invalid): ${r.dropped.join(", ")}.` : ""}`;
  });
}
