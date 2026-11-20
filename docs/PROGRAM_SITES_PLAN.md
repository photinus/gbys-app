# Program Home Pages Plan

Each program can have a public, themeable home page that program admins and org admins edit. It is
reachable two ways:
- **Custom path** on the app's own domain, e.g. `app.goldbeachyouthsports.org/basketball-registration`.
- **Custom domain**, e.g. `ripkenbaseball.org`. The middleware recognises the request host.

A program can also be hidden from the main GBYS site, so its seasons only appear on its own home page
(or through a direct `/register/<slug>` link).

House conventions are unchanged (see the earlier plans and `AGENT_HANDOFF.md`):
- DAL functions take ctx first, authorize inside, and audit. Actions go zod → `runAction` → `revalidatePath`.
- Use `useActionForm` and the `src/components/ui/*` primitives.
- Display times in LA time. No horizontal overflow at 390px.

## Decisions
- **Who edits what:**
  - Program admins (and the board) edit content, theme, sections, path, publish state and "list on main
    site".
  - The **board only** sets the custom domain, because it needs DNS and Railway work.
- **Hidden programs** (`programs.listOnMainSite = false`):
  - Excluded from the main landing page's Open registrations.
  - Excluded from the signed-in dashboard's "Open for your family" suggestions.
  - Their `/register/<slug>` page still works.
  - Their own home page always lists their open seasons.
- **On a custom domain:**
  - Only `/` (the program page) and assets are served.
  - Every other path is redirected (307) to the same path on the app domain. Sign-in, registration and
    auth cookies live on the app domain.
  - Links on a custom-domain page (Register, Sign in, Contact) are absolute, pointing at
    `primaryOrigin()`.
- **Content is plain text only:** rendered escaped, with paragraphs on blank lines, URLs auto-linked
  (`rel="noopener noreferrer nofollow"`), and only http(s) and mailto links allowed. No HTML or Markdown.

## 0. Done by the orchestrator (read it, don't redo it)
- **Schema:** `src/db/schema/sites.ts` holds `program_sites`, one row per program, keyed by `programId`.
  - **Columns:** `isPublished`, `pathSlug` (unique), `customDomain` (unique), `headline`, `tagline`,
    `about`, `accentColor` (#rrggbb, CHECK), `sections` (jsonb `SiteSection[]`: text, faq or links),
    `showOpenRegistrations`, `contactFormId`, `contactEmail`, `contactPhone`, `seoDescription`, hero
    image and logo (bytea + type + updatedAt), and `updatedByUserId`.
  - **`programs.listOnMainSite`** (default true).
  - **Migration:** `drizzle/0016_program_sites.sql`.
- **`src/lib/site-hosts.ts`** (edge-safe):
  - `normalizeHost`, `primaryHosts()`, `isPrimaryHost`, `primaryOrigin()`.
  - `parseCustomDomain(input)`: returns the normalized value or null, and rejects primary hosts and IPs.
  - `RESERVED_PATH_SEGMENTS` and `isValidPathSlug(slug)`.
  - `isCustomDomainPassthrough(path)`.
  - Primary hosts come from `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `RAILWAY_PUBLIC_DOMAIN`,
    `APP_PRIMARY_HOSTS`, Railway's health-check host and localhost.
- **`src/middleware.ts`:**
  - Now matches every path.
  - On a non-primary host, `/` is rewritten to `/sites/domain/<host>`, passthrough assets are served, and
    everything else redirects to `primaryOrigin()`.
  - On primary hosts the behaviour is unchanged: embed headers, plus a cookie check on the signed-in
    prefixes.
- **`src/lib/dal/program-sites.ts`** (read contract):
  - `PublicProgramSite` type.
  - `getPublishedSiteByPath(slug)` and `getPublishedSiteByDomain(host)`: published sites of active
    programs only.
  - `getSiteForPreview(ctx, programSlug)`: requires `canManageProgram`; may be unpublished; returns null
    if there is no row.
  - `getSiteImage(programId, "hero" | "logo")`.
  - Image URLs are `/brand/program/<programId>/{hero,logo}?v=<ms>`.
- **`src/lib/color.ts`:** `ACCENT_PRESETS`, `normalizeHex`, `contrastRatio`, `readableTextOn(accent)`,
  `accentIsAccessible`.
- **Audit:** actions `program_site.updated`, `program_site.published`, `program_site.unpublished`,
  `program_site.address_updated`, `program_site.image_updated`, `program_site.image_removed` and
  `program.listing_updated`; target type `program_site`.

## 1. Workstreams (parallel; no file overlap)

### SA: Editor and admin
**Owns:**
- `src/lib/dal/program-sites-admin.ts`
- `src/lib/validation/program-sites.ts`
- `src/components/program-site-editor/**`
- `src/app/(portal)/programs/[slug]/home-page/page.tsx` and `actions.ts`. The `preview/` subfolder is
  SB's.
- Small link-only edits to `src/app/(portal)/programs/[slug]/page.tsx` (program hub card "Home page")
  and `src/app/(admin)/admin/programs/[id]/page.tsx` (board card: "Home page" with status, address and
  custom domain).

**Who may do what (DAL):**
- Writes need `canManageProgram`, except that the custom domain needs `isBoard`.
- The DAL creates the site row on first save (upsert).

**Editor `/programs/[slug]/home-page`:** sections or tabs, each with its own save.
1. **Status:** Published or Draft toggle, plus links to "Preview" (`/programs/[slug]/home-page/preview`)
   and to the live URL(s).
2. **Content:**
   - Headline (default = program name, ≤ 120 chars), tagline (≤ 200), about (≤ 5000).
   - Contact email and phone, and an optional contact form picked from **this program's active**
     contact forms.
   - "Show open registrations" toggle.
   - SEO description (≤ 300).
3. **Look:**
   - Accent color: the presets plus a custom hex. Refuse colors failing `accentIsAccessible`, and show a
     live swatch with sample button text using `readableTextOn`.
   - Hero image upload (≤ 5 MB in; sniff with `src/lib/image.ts`; png, jpeg or webp only; re-encode with
     sharp to webp, max 1920 wide; store bytea) and remove.
   - Logo upload (512 px max, webp) and remove.
4. **Sections:**
   - Add, reorder (up/down), edit or remove blocks. Types: text (title + body), FAQ (Q&A list) and
     links (label + URL; http(s) or mailto only).
   - Caps: 20 sections, 30 items per section, sensible lengths.
   - Ids are random strings, created server-side.
5. **Address and visibility:**
   - **Path:** shows "app.domain/<path>" with a live availability hint. Must pass `isValidPathSlug`, be
     unique (catch the unique violation with a friendly message) and be lowercase. It can be cleared.
   - **List on the main GBYS site** toggle (`programs.listOnMainSite`), with an explanation.
   - **Custom domain** (board only; read-only for program admins):
     - Validated by `parseCustomDomain`, unique, and can be cleared.
     - Shows the DNS steps: in Railway, add the domain to the web service (Settings → Networking → Custom
       domain), create the CNAME record Railway shows at the DNS provider, and wait for the certificate.
     - Also list `www.` as a separate domain if wanted.
- Publishing requires at least a path or a domain. Show a warning if neither is set.
- Audit every write, with before and after values for the address, domain and listing fields.

### SB: Public rendering and visibility
**Owns:**
- `src/components/program-site/**`, the themed public page.
- `src/app/(site)/layout.tsx`: a new route group with its own minimal chrome (program logo and name,
  Sign in link). It must not use the GBYS `(public)` header.
- `src/app/(site)/[siteSlug]/page.tsx`: the path route.
- `src/app/(site)/sites/domain/[host]/page.tsx`: the custom-domain route.
- `src/app/brand/program/[programId]/[kind]/route.ts`: the image route. Copy the headers from
  `/brand/logo` (immutable cache, nosniff, sandbox CSP); 404 for an unknown program or kind.
- `src/app/(portal)/programs/[slug]/home-page/preview/page.tsx`.
- Edits to `src/lib/dal/registrations.ts`:
  - Add the `listOnMainSite` filter to `listOpenSeasons` and `listOpenSeasonsForMyAthletes`.
  - Add `listOpenSeasonsForProgram(programId)` with the same open rule and ordering.
- `src/lib/site-text.ts`: escaped paragraphs plus safe auto-linking, unit-tested.

**Page design:** consistent with the app's look (Plus Jakarta, rounded cards, pastel cards), themed by
the accent color.
- **Hero:** the image with a dark overlay for legible text, or an accent gradient when there's no image.
  It shows the headline, tagline and a primary "Register" CTA that jumps to the open registrations
  section (or shows "No open registrations right now").
- **Body:**
  - About (paragraphs).
  - Open registrations, reusing `OpenSeasonCard`. Its Register link goes to `/register/<slug>` and must
    be absolute on a custom domain. Add an optional `registerHref` prop to the card without changing its
    default.
  - The sections: text, FAQ (`<details>`) and links.
  - Contact: email (mailto), phone (tel), and a button to `/contact/<formSlug>` (absolute on a custom
    domain).
- **Footer:** "Part of Gold Beach Youth Sports", linking to the main site, plus the org name from
  settings.
- Buttons and links use the accent with `readableTextOn` for text color.
- `generateMetadata`: title "<headline> · <program name>", description = SEO description or tagline,
  OG image = hero, and canonical = `https://<customDomain>/` if set, else `<primaryOrigin>/<pathSlug>`.
- **Path route:** `notFound()` when not found or unpublished. Path lookups are case-insensitive: redirect
  uppercase to lowercase.
- **Domain route:** if there's no published site for the host, redirect to `primaryOrigin()`. Also
  refuse to render when the request's Host doesn't match the `[host]` param (read `headers()`), so
  `/sites/domain/x` on the app domain can't be used to impersonate. In that case redirect to the
  canonical URL.
- **Preview:** for program admins and the board (`getSiteForPreview`). Renders the same component even
  when unpublished, with a "Preview — not published" banner and relative links. Empty state when there's
  no row yet, linking to the editor.
- **Main landing page:** unchanged, apart from the filtered list.

## 2. Testing
- **Fresh DB:** `gbys_<ws>` (SA: `gbys_sa`, port 3241, `.next-sa`; SB: `gbys_sb`, port 3242, `.next-sb`).
  Run `npm run db:migrate:prod && npm run db:seed`. If Postgres is down, run `service postgresql start`.
- **DAL tests** use the `server-only` stub (see `docs/FINANCE1_PLAN.md` §2).
- **Custom-domain testing locally:** `curl -H "Host: ripken.test" http://localhost:<port>/`, and
  Playwright with
  `chromium.launch({ args: ["--host-resolver-rules=MAP ripken.test 127.0.0.1"] })` and
  `http://ripken.test:<port>/`. Set `BETTER_AUTH_URL=http://localhost:<port>` so `localhost` is primary.
- **Checks:**
  - 390px overflow on the editor, public and preview pages.
  - Lighthouse-style basics: heading order, alt text, contrast via the accent helper.
- **Gate:** `npx tsc --noEmit` is clean and the build succeeds. Run `git checkout tsconfig.json` after
  builds. Don't commit.
