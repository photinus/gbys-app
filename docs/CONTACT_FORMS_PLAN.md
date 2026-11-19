# Contact Forms Plan (public, embeddable, Turnstile-protected, per program)

These contracts bind the two parallel workers. Earlier conventions still apply:
- DAL functions take `ctx` first and authorize inside.
- Server actions follow zod → `runAction` → `revalidatePath` → `ActionResult`.
- Forms use `useActionForm`.
- UI comes only from `src/components/ui/*`.
- Times are shown in LA time.
- No horizontal overflow at 390px.

## Decisions
- **One or more forms per program, plus org-wide forms** (`programId` null).
  - Program forms are managed by `canManageProgram`: program admins or the board.
  - Org-wide forms are managed by the board only.
- **Fields.** Name, email and message are always present and required. Phone is optional (`collectPhone` / `phoneRequired`). On top of these, a form can have up to **15** extra fields, stored in `fields` using the seasons `CustomFormField` format and validated with `customFormSchemaSchema` plus a max of 15.
  - **Reuse** the season form builder (`src/components/seasons/form-builder.tsx`, `form-preview.tsx`) and `buildAnswersSchema` from `src/lib/custom-form.ts`.
- **Where submissions go.** Every submission is stored and appears in an in-app **inbox**. It is also emailed to `recipientEmails`, plus the program's admins when `notifyProgramAdmins` is set, with reply-to set to the submitter.
  - **No auto-reply to the submitter**, so the form can't be used to send email to strangers.
- **Spam defense.**
  - **Cloudflare Turnstile**, verified server-side, including that the token's `hostname` is our app host.
  - A hidden **honeypot** field.
  - **Rate limits:** at most 5 submissions per IP-hash per form per hour, and 200 per form per hour.
  - Body size caps.
- **Privacy.** The raw IP is never stored. `ipHash = HMAC-SHA256(BETTER_AUTH_SECRET, ip)`.
- **Embedding.**
  - An `<iframe>` of `/embed/contact/<slug>`, plus `public/embed.js`, which auto-resizes the iframe via `postMessage` (it validates the message origin and source).
  - `/embed/*` is framable only by `EMBED_ALLOWED_ORIGINS`. Every other page is un-framable.
  - A hosted, branded page lives at `/contact/<slug>`.

## 0. Done by the orchestrator (read it, don't redo it)
- **Schema** (`src/db/schema/contact.ts`, migration `0010`):
  - `contact_forms`: `slug` is unique; there is a check that `phoneRequired` implies `collectPhone`.
  - `contact_submissions`: status is `new`, `read`, `archived` or `spam`. Columns include `ipHash`, `userAgent`, `embedReferrer` (origin plus path only), `notificationSentAt` and `readAt`/`readBy`. Indexes exist for rate limiting.
- **Audit actions:** `contact_form.created`, `contact_form.updated`, `contact_submission.status_changed`, `contact_submission.deleted`. Targets are `contact_form` and `contact_submission`. Don't audit each public submission.
- **Clickjacking.**
  - `next.config.ts` sends `X-Frame-Options: DENY` and `frame-ancestors 'none'` on everything **except** `/embed/*`.
  - `src/middleware.ts` sets `frame-ancestors 'self' <EMBED_ALLOWED_ORIGINS>` on `/embed/*` at request time. It does **not** require auth on `/embed/*`.
  - `src/lib/embed-origins.ts` exports `embedAllowedOrigins()`, which is edge-safe.
- **Nav:** a board entry "Contact forms" → `/admin/contact`.
- **`.env.example`:** `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `EMBED_ALLOWED_ORIGINS`.

## 1. Workstreams (run in parallel; no file overlap)

### C1: Admin — form configuration and inbox
**Owns:**
- `src/lib/validation/contact-forms.ts`
- `src/lib/dal/contact-forms.ts` (form CRUD and inbox)
- `src/app/(admin)/admin/contact/**`:
  - `page.tsx`: the inbox, with tabs or links to forms
  - `forms/page.tsx`: the forms list
  - `forms/[id]/page.tsx`: the editor
  - `actions.ts`
- `src/app/(portal)/programs/[slug]/contact/**`: the program-scoped inbox and forms, for `canManageProgram`
- `src/components/contact-admin/**`
- A one-card or one-link edit to `src/app/(portal)/programs/[slug]/page.tsx`: "Contact forms", with a count of new submissions.

**DAL** (authorization inside every function):
- `canManageContactForm(ctx, programId | null)`: `canManageProgram` for a program form, `isBoard` for an org-wide one.
- `listContactForms(ctx, scope)`: scope is `{ all }` (board only) or `{ programId }`.
- `getContactForm(ctx, id)`.
- `createContactForm`, `updateContactForm`:
  - Slug is lowercase kebab-case, 3–60 characters, unique. Suggest one from the title.
  - Title, intro (≤ 1000 chars, plain text), phone options and custom fields (≤ 15).
  - Recipient emails: 0–10 valid addresses, lowercased. Require at least one recipient **or** `notifyProgramAdmins` on a program form.
  - Submit label, success message (≤ 500), privacy note (≤ 500), `isActive`.
  - A program form's `programId` can't change after creation.
  - Audit each change with the names of the changed fields.
- **Inbox:**
  - `listSubmissions(ctx, { scope, formId?, status?, q?, cursor? })`: keyset pagination over `createdAt desc, id`, 50 per page; `q` searches name and email.
  - `getSubmission(ctx, id)`: marks the row `read` (setting `readAt`/`readBy`) on first open.
  - `setSubmissionStatus(ctx, id, status)`: audited.
  - `deleteSubmission(ctx, id)`: board only, hard delete for PII requests, audited with the form id and a timestamp only. Don't put the submission's contents in the audit row.
  - `countNewSubmissions(ctx, scope)`.

**UI:**
- **Forms list:** title, program (or "Org-wide"), active badge, new-submission count, "Edit", and "Get embed code".
- **Form editor:**
  - Core settings, the shared **form builder** with live preview, recipients (chips input), and notify program admins.
  - An **Embed** panel. It shows the hosted URL `<BETTER_AUTH_URL>/contact/<slug>` and a copyable snippet:
    ```html
    <iframe src="<APP>/embed/contact/<slug>" title="<title>" style="width:100%;border:0;min-height:520px" loading="lazy"></iframe>
    <script src="<APP>/embed.js" async></script>
    ```
  - A note listing the current `EMBED_ALLOWED_ORIGINS` entries, from `embedAllowedOrigins()`, and saying they're set on Railway.
- **Inbox:** filters (form, status, search) and a table that becomes cards on mobile. A detail sheet shows all answers with field labels, a `mailto:` reply button, and mark read, archive or spam. Board users also get delete, with a confirmation.

### C2: Public form, Turnstile, submission pipeline, embed script
**Owns:**
- `src/lib/turnstile.ts`
- `src/lib/dal/contact-submit.ts`
- `src/lib/validation/contact-submit.ts`
- `src/app/(public)/contact/[slug]/**`: the hosted, branded page
- `src/app/embed/contact/[slug]/**`:
  - It sits **outside** the `(public)` layout and needs its own minimal layout: no site header or footer, a transparent-friendly alabaster background, and the branding font.
  - Use a route group or a nested layout under `src/app/embed/`.
- `src/app/embed/layout.tsx`
- `public/embed.js`
- `src/components/contact-public/**`
- `src/lib/email.ts`: add one function only.

**Turnstile** (`src/lib/turnstile.ts`):
- `getTurnstileConfig()` returns `{ siteKey, enabled }`.
  - In **production** (`NODE_ENV === "production"`) both keys are required. Without them the public form shows "This form is temporarily unavailable" and submissions are refused.
  - Outside production, with no keys set, use Cloudflare's documented always-pass **test keys**:
    - site `1x00000000000000000000AA`
    - secret `1x0000000000000000000000000000000AA`
- `verifyTurnstile(token, remoteIp?)` POSTs to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with a 5s timeout.
  - Require `success === true`.
  - Require the returned `hostname` to equal the app host, from `BETTER_AUTH_URL` or the request host. Skip this hostname check only for the test keys.
  - Treat a network error as failure ("Couldn't verify you're human, try again").
- Load the widget script from `https://challenges.cloudflare.com/turnstile/v0/api.js` with explicit render. Refresh the token after a failed submit.

**Submit** (`submitContactForm(input, meta)`):
- No session. This is a public action, and the allowed exception to `ctx`-first.
- Steps:
  1. Load the form by slug. It must exist and be active; otherwise return a generic not-available response.
  2. If the honeypot field is filled, return a fake success and store nothing.
  3. Validate the core fields:
     - name: 1–120 chars
     - email: valid, ≤ 254 chars
     - phone: normalized with the household `normalizePhone`; required when configured
     - message: 1–5000 chars
  4. Validate the answers with `buildAnswersSchema(form.fields)`.
  5. Verify Turnstile.
  6. Check rate limits by counting the same `ipHash` and the form's submissions in the last hour. Refuse with a friendly message.
  7. Insert the row, with `embedReferrer` set to the origin plus path of a sanitized `Referer` or a client-sent `document.referrer`.
  8. **After commit**, best-effort, send `sendContactSubmissionEmail` to the deduped recipients: `recipientEmails`, plus active program admins' emails when `notifyProgramAdmins` (skipping bounced or deleted users). Set `notificationSentAt` on success. An email failure doesn't fail the submission.
- The client IP is the first `x-forwarded-for` hop, falling back to `x-real-ip`.

**Email** (`sendContactSubmissionEmail({ to: string[], replyTo, formTitle, programName?, name, email, phone?, message, answers: { label, value }[], inboxUrl })`):
- Escape every value.
- Set `replyTo` to the submitter. Check how the installed `@nuntly/sdk` takes reply-to; if it doesn't support it, put the submitter's address prominently in the body.
- Subject: `New message: <formTitle> — <name>`.
- Link to the inbox. **Don't** include anything beyond what was submitted.

**Pages:**
- `/contact/[slug]` renders in the public layout with branding (logo and org name), the form title and intro, the form, and the privacy note.
- `/embed/contact/[slug]` renders the same form component, compact.
- Both return a friendly 404 for unknown or inactive forms.
- On success, replace the form with `successMessage`.
- Accessibility:
  - Visible labels, field-level errors and `aria-live` for status.
  - The honeypot field is visually hidden with `aria-hidden` and `tabindex=-1`.
- **Embed resizing:** the embed page posts `{ type: "gbys:contact:height", height }` to `window.parent` on load, on resize (via `ResizeObserver`) and after submit.

**`public/embed.js`:**
- Plain ES5-safe JavaScript, under about 1.5 KB, with no globals beyond one IIFE.
- Find the app origin from its own `document.currentScript.src`.
- Listen for `message` events where `event.origin === appOrigin` and `data.type === "gbys:contact:height"`.
- Match the sending iframe by comparing `event.source` with each `iframe.contentWindow` whose `src` starts with `appOrigin + "/embed/"`, then set that iframe's height.
- Never trust or evaluate any other data.

## 2. Shared rules
- **Ownership:** touch only the files you own.
  - Never edit the schema, migrations, `middleware.ts`, `next.config.ts`, `embed-origins.ts`, `nav*.ts`, `permissions.ts` or `context.ts`.
  - Report anything you need changed in those files.
- **Builds:** use `NEXT_DIST_DIR=.next-<ws>`, run `git checkout tsconfig.json` afterwards, and leave no processes running.
- **Database:** each worker uses its own `gbys_<ws>` on localhost:5432 (postgres/postgres; run `pg_ctlcluster 16 main start` if it's down).
  - Set up with `DATABASE_URL=... npm run db:migrate:prod && npm run db:seed`.
  - Insert fixtures with SQL.
  - Never write `.env`. Drop your DB when you're done.
- **Verify:**
  - `npx tsc --noEmit` and `next build`.
  - A DAL test.
  - A Playwright pass with the magic-link dev login.
  - 390px widths.
  - Keep scripts in the scratchpad.
- **Git:** don't commit or push. Report concisely.
