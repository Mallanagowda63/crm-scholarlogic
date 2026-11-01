# ScholarLogic

A CRM for Theta, a coaching centre. It manages the student journey: enquiry → contacted → demo class → admission → fee payment → enrolled.

**Status:** Phases 1 and 2 of 8 are complete. This covers the design system, app layout, sign-in, roles, database schema and sample data. Modules from later phases show a page saying which phase delivers them.

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
| Counsellor | `counsellor@theta.example` | Dashboard, leads, students, applications, courses, tasks, communication |
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
| `npm run db:up`      | Starts Postgres in Docker                           |
| `npm run db:down`    | Stops Postgres and keeps its data                   |
| `npm run db:migrate` | Creates a migration after editing the Prisma schema |
| `npm run db:deploy`  | Applies existing migrations                         |
| `npm run seed`       | **Erases the local database** and adds sample data  |

The seed script refuses to run in production or against a database that isn't on this computer.

## Project structure

```
docker-compose.yml      Local Postgres
prisma/                 Database schema, migrations and seed script
src/app/(auth)/         Sign-in page
src/app/(app)/          Signed-in pages, wrapped in the app layout
src/components/layout/  Sidebar, top bar, command palette, menus
src/components/shared/  Reusable pieces such as empty states and avatars
src/components/ui/      shadcn/ui components
src/lib/db.ts           Database client and soft-delete rules
src/lib/modules.ts      Navigation and which roles can open each module
src/lib/rate-limit.ts   Sign-in rate limiting
src/lib/session.ts      Server-side user lookup and role checks
src/server/actions/     Server Actions
```

## Access control

Middleware sends signed-out visitors to the sign-in page. Role checks happen on the server in `src/lib/session.ts`, which reads the user from the database on every request. Changing someone's role or deactivating them therefore takes effect immediately.

To protect a page, call `requireModuleAccess("module-id")` at the top. Keep skeleton loaders in a `<Suspense>` inside the page, after that call. A `loading.tsx` above the page would start the response before the check runs, so a blocked request would get status 200 instead of a redirect.

## Sign-in rate limiting

Failed attempts are stored in the database, so limits apply across server restarts and instances. Sign-in is blocked for 15 minutes after 5 failures for one email and IP address, or 20 failures for one email from any address. A successful sign-in clears the count for that email and address.

Set `x-forwarded-for` from a trusted proxy in production, because clients can forge that header when they connect directly. The per-email limit is the backstop.

## Data rules

- **One record per person:** `Student` covers someone from first enquiry onward. The UI says "lead" before the Enrolled stage and "student" after it.
- **Money:** stored as whole paise. GST rates are stored in basis points, so 18% is `1800`.
- **Dates:** stored in UTC and shown in India time.
- **Deleting:** `Student`, `Application` and `Payment` are soft-deleted by setting `deletedAt`. A database trigger blocks `DELETE` on these and on `FeePlan`, `Instalment` and `Receipt`. Cancel a plan or instalment with `cancelledAt`.
- **Reading soft-deleted data:** top-level queries hide deleted rows automatically. An `include` of those models must add `where: { deletedAt: null }` itself.
