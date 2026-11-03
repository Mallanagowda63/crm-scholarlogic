# ScholarLogic

A CRM for Theta, a coaching centre. It manages the student journey: enquiry → contacted → demo class → admission → fee payment → enrolled.

**Status:** All 8 build phases are complete. See [GO_LIVE.md](GO_LIVE.md) for what must be done before production.


## Requirements

- Node.js 22 or newer
- Docker Desktop, which runs Postgres on port 5433

## Setup

```bash
npm install
cp .env.example .env     # then set POSTGRES_PASSWORD, the same password in DATABASE_URL,
                         # and AUTH_SECRET (run `npx auth secret` to generate one)
npm run db:up            # starts Postgres in Docker
npm run db:deploy        # creates the tables
npm run seed             # adds the sample data
npm run dev
```

Open http://localhost:3000.

## Demo accounts

These exist only in development. The password for all of them is `Theta@12345`.

| Role       | Email                      | Can open                                                                |
| ---------- | -------------------------- | ----------------------------------------------------------------------- |
| Admin      | `admin@theta.example`      | Everything                                                              |
| Counsellor | `counsellor@theta.example` | Dashboard, leads, students, admissions, courses, tasks, communication   |
| Accounts   | `accounts@theta.example`   | Dashboard, students, fees                                               |
| Viewer     | `viewer@theta.example`     | Dashboard and reports, read-only                                        |

`kavya@theta.example` and `sandeep@theta.example` are extra counsellors.

## Scripts

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `npm run dev`        | Starts the development server                       |
| `npm run build`      | Creates a production build                          |
| `npm run start`      | Runs the production build                           |
| `npm run lint`       | Runs ESLint                                         |
| `npm run typecheck`  | Runs the TypeScript compiler                        |
| `npm test`           | Builds the app and runs all browser and data tests  |
| `npm run test:report` | Opens the report from the last test run            |
| `npm run db:up`      | Starts Postgres in Docker                           |
| `npm run db:down`    | Stops Postgres and keeps its data                   |
| `npm run db:migrate` | Creates a migration after editing the Prisma schema |
| `npm run db:deploy`  | Applies existing migrations                         |
| `npm run seed`       | **Erases the local database** and adds sample data  |
| `npm run create-admin` | Creates an admin account, including in production |

The seed script refuses to run in production or against a database that isn't on this computer.

## Creating an admin

`npm run create-admin` asks for a name, email and password at a prompt. The password is hidden as you type, and is never accepted as a command-line argument, so it stays out of shell history. It refuses to change an existing account.

## Enrolment and fees

- Someone can only move to Enrolled once they have an admission with a batch and a fee plan, and the batch has a free seat. Leaving Enrolled frees the seat.
- Payments count toward the earliest instalments first.
- Every payment gets a receipt numbered per Indian financial year, such as `THETA/2026-27/0001`. Cancelling a payment keeps the receipt on record, marked as cancelled, and its number is never reused.

## Dashboards and reports

Each role gets its own dashboard. Counsellors see only their own numbers, accounts sees fees, and viewers see totals and charts without lists naming students.

- **Funnel:** how many people ever reached each stage, so someone lost later still counts for the stages they passed through.
- **Conversion rate:** enrolled, of the enquiries in the period, grouped by when they enquired.
- **Revenue:** payments received in the period, including GST and leaving out cancelled ones.

## Messages

Templates can use `{{name}}`, `{{course}}` and `{{due_date}}`. The Message button on a profile fills them in for that person, then opens WhatsApp or the email app with the message ready to review. It's logged on the timeline when opened. No message is sent automatically, as no paid WhatsApp or email service is connected.

## Reminders

A task's reminder becomes a notification the next time its assignee's browser checks, which happens when the app opens and every minute after that. There's no background job, so nothing is sent while nobody has the app open.

## Uploaded documents

Files go in `UPLOAD_DIR`, or `uploads/` by default, which isn't served publicly. Downloads go through a route that checks permissions. PDF, JPG, PNG and WebP files up to 5 MB are accepted, judged by their contents rather than their names.

## Tests

`npm test` needs Docker running. It creates a separate `scholarlogic_test` database, rebuilds it from the migrations and seed data, then tests a production build on port 3200. Your development database and dev server aren't affected.

Tests use Microsoft Edge by default. To use another browser, run `npx playwright install chromium` and set `PW_CHANNEL=chromium`.

Run the tests at the end of every phase, and add tests for whatever the phase builds.

## Project structure

```
docker-compose.yml      Local Postgres
prisma/                 Database schema, migrations and seed script
tests/                  Playwright tests, run in file order
src/app/(auth)/         Sign-in page
src/app/(app)/          Signed-in pages, wrapped in the app layout
src/app/(app)/leads/    Leads table, board, forms, import and export
src/app/(app)/students/ Students list and the student profile
src/app/(app)/tasks/    Task list and calendar
src/app/(app)/courses/  Courses and batches
src/app/(app)/admissions/ Admissions list
src/app/(app)/fees/     Fee overview and PDF receipts
src/app/(app)/reports/  Reports and CSV exports
src/app/(app)/communication/ Message templates and the contact log
src/app/(app)/settings/ Users, stages, lists, organisation and branding
src/server/analytics.ts Numbers behind the dashboards and reports
assets/fonts/           Fonts embedded in receipts
scripts/                Command-line tools
src/components/layout/  Sidebar, top bar, command palette, menus
src/components/shared/  Reusable pieces such as empty states and avatars
src/components/ui/      shadcn/ui components
src/lib/db.ts           Database client and soft-delete rules
src/lib/modules.ts      Navigation and which roles can open each module
src/lib/rate-limit.ts   Sign-in rate limiting
src/lib/session.ts      Server-side user lookup and role checks
src/server/             Database queries, audit log and CSV import
src/server/actions/     Server Actions
```

## Access control

Middleware sends signed-out visitors to the sign-in page. Role checks happen on the server in `src/lib/session.ts`, which reads the user from the database on every request. Changing someone's role or deactivating them therefore takes effect immediately.

Counsellors only see and change leads assigned to them, and only admins can reassign or delete. Accounts can see the Overview, Admission and Payments tabs of students with an admission, and can't change anything or open documents. Server Actions enforce this themselves using `getUserWithAccess` and `ownedBy`, so hidden buttons aren't the only protection.

To protect a page, call `requireModuleAccess("module-id")` at the top. Keep skeleton loaders in a `<Suspense>` inside the page, after that call. A `loading.tsx` above the page would start the response before the check runs, so a blocked request would get status 200 instead of a redirect.

## Sign-in rate limiting

Failed attempts are stored in the database, so limits apply across server restarts and instances. Sign-in is blocked for 15 minutes after 5 failures for one email and IP address, or 20 failures for one email from any address. A successful sign-in clears the count for that email and address.

Set `x-forwarded-for` from a trusted proxy in production, because clients can forge that header when they connect directly. The per-email limit is the backstop.

## Data rules

- **One record per person:** `Student` covers someone from first enquiry onward. The UI says "lead" before the Enrolled stage and "student" after it.
- **Money:** stored as whole paise. GST rates are stored in basis points, so 18% is `1800`.
- **Dates:** stored in UTC and shown in India time.
- **Deleting:** `Student`, `AcademicRecord`, `Document`, `Admission` and `Payment` are soft-deleted by setting `deletedAt`. A database trigger blocks `DELETE` on these and on `FeePlan`, `Instalment` and `Receipt`. Cancel a plan or instalment with `cancelledAt`.
- **Reading soft-deleted data:** top-level queries hide deleted rows automatically. An `include` of those models must add `where: { deletedAt: null }` itself.
