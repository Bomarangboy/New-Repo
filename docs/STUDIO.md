# Platform Studio

**Status:** Stage 8. Implemented and tested (unit, integration and browser tests). Works with the existing stack —
no new service, account or storage is needed (images are stored in the database). Not deployed yet.

Platform Studio is the administrator-only editor for the **look, wording, menu and Overview layout** of Bluewater.
Admin → **Platform Studio**. Every change goes Draft → Preview → Publish.

## What you can change
| Area | What | Levels |
|---|---|---|
| Brand | Platform name, wordmark words, logos (light/dark background), favicon, brand color, sidebar color, font (Figtree, system font, classic serif) | name & favicon: platform only; others: all levels |
| Wording | Page headings and descriptions, button labels, empty-state text, sign-in page text, help and support details, onboarding instructions | sign-in text: platform only; others: all levels |
| Packages | Display name, short description, upgrade message, display price **text** for each package | platform only |
| Menu | Order (Move up / Move down buttons), labels, hide items, page shown after sign-in | all levels (sign-in page per package) |
| Overview layout | Up to four number tiles (from existing measurements), card order, width (third/half/two-thirds/full), show/hide | all levels |

## What it can never change (by design)
Sign-in and two-step verification, company separation, who can do what, what each package includes, prices people
pay, opt-out (STOP) protections, sending rules, critical notices (emergency stop, read-only, support session,
demo/simulation banners) and the activity log. Only settings listed in `src/server/studio/registry.ts` exist;
anything else is refused. **Hiding** a menu item or card is visual only: every page still checks permissions on the
server, and a card or menu item only appears when the package and role include it. Overview, Settings and
Help & Support can't be hidden.

Related settings live in their own screens (the Studio links to them): automatic-reply wording, follow-ups and
sending hours (each client's Automations, or the Sequence Library), booking, package/status/price per company,
team members. Pipelines, custom fields and assignment rules don't exist yet (would need development).

## Levels (inheritance)
**Platform default** → **package default** → **one company**. Each level stores only what it changes. A company
that hasn't customized a setting follows its package, which follows the platform. When you publish a change at a
higher level, companies (or packages) that set their own value **keep it** — the publish screen lists them before you
publish. Every field shows “Inherited from …” or “Set here”, with **Reset to inherited**.

## Draft → Preview → Publish
1. **Edit** a tab and press **Save … draft**. Nothing is live. Saving is refused if another administrator saved the
   same draft after you opened it (“Someone else saved changes…”) — reload and redo your change.
2. **Preview & publish** tab: the draft rendered as an owner or employee, per package, on desktop or phone width,
   plus the sign-in page. Previews use sample numbers and only read Studio settings — they can't send messages,
   enroll anyone, change billing or touch customer records.
3. Check the change list, the scope (“reaches N workspaces”) and who keeps their own values; fix any validation errors.
4. Write a short summary and **Publish**. It's versioned, recorded in the activity log, and everyone sees it on their
   next page load.

## History and restore
**History** lists every published version. **Copy into draft** puts an old version into the draft (then preview and
publish). Settings that no longer exist or no longer pass validation are dropped and listed. Restoring changes
appearance only — never customer data, billing or automation settings (the Studio doesn't store those).

## Safety checks
- Text is plain text only: HTML, links-with-code, scripts and event handlers are refused; lengths are limited.
- Colors: white button text on the brand color must reach 3:1 (warning under 4.5:1; links are darkened automatically
  to 4.5:1); white menu text on the sidebar color must reach 7:1.
- Images: PNG/JPEG/WebP (logos, ≤ 512 KB, 80–2000 px wide) and square PNG/ICO (favicon, ≤ 100 KB). The file's actual
  bytes are checked; SVG, HTML and anything script-like is refused. Images are served with headers that forbid scripts.

## Recovery (if a published layout makes the admin area hard to use)
1. **Fastest:** in Vercel → Project → Settings → Environment Variables set `STUDIO_SAFE_MODE` = `true` and redeploy.
   Everyone sees the built-in Bluewater look; Studio settings are ignored (not deleted). Fix the draft and publish, then
   set it back to `false`.
2. **Reset from a computer** (developer or owner with the database connection):
   `npx tsx scripts/studio-reset.ts` (list) → `npx tsx scripts/studio-reset.ts platform` (or `all`). This publishes a
   new empty version (= built-in look); earlier versions stay in History.
3. The known-good default is the built-in look itself (registry defaults), which both methods return to.

## Who can use it
Bluewater platform administrators with two-step verification. There is no delegated editor role yet; adding one would
need an explicit scope (e.g. one company) and is future work.

## Technical notes
Tables: `studio_drafts` (platform-only), `studio_published` (readable by the company it applies to; platform/package
rows by everyone), `studio_versions` (append-only), `studio_assets` (platform-only). Migrations `0014`/`0015`.
Reading: `src/server/studio/runtime.ts`; editing: `service.ts`; settings and validation: `registry.ts`.
