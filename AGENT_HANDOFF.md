# Gold Beach Youth Sports (GBYS) — Coding Agent Handoff Specification

## 1. Mission & Product Overview
**Gold Beach Youth Sports (GBYS)** is a 100% volunteer-run 501(c)(3) umbrella organization in Gold Beach, Oregon (Curry County). The platform serves two primary purposes:
1. **Internal League & Clinic Operations:** Manage GBYS-run youth sports programs, clinics, camps, facility bookings, volunteer compliance, and volunteer time tracking.
2. **Shared Infrastructure for Independent Partner Leagues:** Allow local independent leagues (e.g., Cal Ripken / Babe Ruth Baseball, Youth Wrestling, Soccer) to plug in with isolated finances, rosters, and custom registration forms while sharing central volunteer pools, background check credentials, and facility schedules.

---

## 2. Locked Technology Stack
- **Frontend & Backend Framework:** Next.js (App Router, TypeScript) + Tailwind CSS + Shadcn UI, configured as an offline-capable PWA (Serwist / `next-pwa`) for low-reception gyms and fields.
- **Database & ORM:** Railway Managed PostgreSQL + **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`).
- **Authentication:** **Better Auth** (`better-auth`) using Drizzle adapter, supporting:
  - Google OAuth (`socialProviders.google`) with automatic verified email linking.
  - Passwordless Magic Links delivered via Nuntly.
- **File Storage:** Railway Object Storage (S3-compatible private bucket) for First Advantage clearance receipts, SafeSport/concussion certificates, and signed waiver artifacts.
- **Payments:** **Stripe Connect (Standard Accounts)** so independent partner leagues connect their own Stripe accounts (`transfer_data` / direct charges) with optional `application_fee_amount` routing to GBYS.
- **Transactional Email:** **Nuntly** (`@nuntly/sdk`) + Nuntly Webhooks (`/api/webhooks/nuntly`) to track delivery and flag `emailBounced` on user records.
- **Background Checks:** Manual credential verification vault (primarily **First Advantage** via Cal Ripken / Babe Ruth partner portal, plus USA Wrestling / NCSI equivalents). **Do NOT collect or store SSNs or raw criminal reports.**
- **SMS:** Deferred to Phase 3. Keep `phone` and `smsOptIn` fields on `users` and design notifications around a `channel` enum (`email`, `sms`, `in_app`).

---

## 3. Core Architectural Invariants (DO NOT VIOLATE)
1. **Multi-Tenant Program Hierarchy:** Never attach registrations, schedules, or roles directly to the root org alone. Always scope through `Organization -> Programs -> Seasons -> Registrations / Bookings`.
2. **Decoupled Person vs. Contextual Roles:** Never create separate `coaches`, `parents`, or `admins` auth tables. Every adult has one `users` record and holds contextual roles via `program_roles` (`program_admin`, `head_coach`, `assistant_coach`, `team_manager`, `volunteer`) plus `orgRole` on `users` (`super_admin`, `board_member`, `member`).
3. **COPPA-Safe Household & Multi-Guardian Model:** Children (`athletes`) do **not** have login accounts. Adults link to athletes via the `household_guardians` many-to-many join table (`canSignWaivers`, `receivesComms`).
4. **Application-Layer Data Access Layer (DAL):** Because Railway Postgres connects via a single service role (`DATABASE_URL`), **all database queries must flow through `src/lib/dal/`** which enforces `sessionContext` (`userId`, `orgRole`, `programRoles`) and writes sensitive access events to `audit_logs`.
5. **Immutable Versioned Waivers:** Never overwrite waiver text or signatures. Store `waiverVersion` and `waiverTextHash` alongside `signedAt`, `ipAddress`, and `userAgent` in `signed_waivers`.
6. **Financial Separation (Registrations vs. Payments):** Support online Stripe Connect payments as well as offline `cash`, `check`, and `waived_scholarship` statuses on `registrations`. Always enforce webhook idempotency via `webhook_events`.
7. **Grant-Auditable Volunteer Time Ledger:** `volunteer_logs` must remain immutable (soft-delete only via `deletedAt`) and capture `category`, `durationMinutes`, `verificationMethod` (`self_reported`, `shift_checkin`, `admin_approved`), and `inKindRateCents` (snapshot of Independent Sector volunteer hourly valuation). Checking into a `volunteer_shifts` slot should auto-create an approved `volunteer_logs` entry.
8. **Hierarchical Facility Conflict Detection:** `resources` supports `parentResourceId` (e.g., *High School Gym* -> *Mat 1*, *Mat 2*). Booking a parent resource blocks all children; booking a child blocks overlapping bookings on itself and its parent.
9. **Timezone Discipline:** Store all database timestamps as `timestamptz` (UTC). Format all UI displays, registration deadlines, and cron evaluations in `America/Los_Angeles`.

---

## 4. Phased Implementation Plan

### Sprint 1: Foundation, Auth, Households & Compliance Vault
- Scaffold Next.js App Router + Tailwind + Shadcn UI + Drizzle ORM + Better Auth.
- Configure Google OAuth + Nuntly Magic Link sign-in (`src/lib/auth.ts`).
- Build Household Management: Adult profile (`phone`, `smsOptIn`), adding dependent `athletes` (with medical notes & JSONB emergency contacts), and inviting co-guardians (`household_guardians`).
- Build the **Volunteer Credential Vault**: Seed `credential_definitions` (`first_advantage_bg`, `safesport`, `concussion`, `code_of_conduct`), upload proof PDFs/screenshots to Railway S3 (`src/lib/storage.ts`), and build the Board Compliance Verification Queue.

### Sprint 2: Volunteer Shifts & Grant Reporting Engine
- Build `volunteer_shifts` creation (by program/event) and volunteer shift sign-up + kiosk/admin check-in (auto-generating `shift_checkin` entries in `volunteer_logs`).
- Build standalone mobile-friendly volunteer hour submission form for ad-hoc coaching, board, and prep hours.
- Build the **Grant Export Engine** (`/admin/grants`): Filter `volunteer_logs` by date range, program, category, and verification status; calculate total hours and in-kind dollar value; export formatted CSV and printable PDF summary.

### Sprint 3: Dynamic Registration, Stripe Connect & Facilities
- Build `seasons` dynamic form builder (`customFormSchema` JSONB) and public registration checkout flow with versioned waiver e-signature capture (`signed_waivers`).
- Integrate **Stripe Connect (Standard)** onboarding for independent partner leagues (`programs.stripeAccountId`) and checkout routing with `application_fee_amount` support.
- Build offline payment recording (`cash`, `check`, `waived_scholarship`) and coach read-only Team Emergency Sheet with PWA offline caching.
- Build hierarchical `resources` & `resource_bookings` calendar with parent-child conflict detection.
