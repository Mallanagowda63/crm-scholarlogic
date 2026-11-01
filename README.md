# ScholarLogic

A CRM for Theta that manages the student journey: enquiry → lead → counselling → application → admission → fee payment → enrolled.

**Status:** Phase 1 of 8 is complete. This covers the design system, app layout, sign-in and roles. Modules from later phases show a page saying which phase delivers them.

## Requirements

- Node.js 22 or newer
- SQLite for local development, which needs no separate install

## Setup

```bash
npm install
cp .env.example .env     # then set AUTH_SECRET: run `npx auth secret` to generate one
npm run db:push          # creates the local database
npm run seed             # adds the demo accounts
npm run dev
```

Open http://localhost:3000.

## Demo accounts

These exist only in development, and the seed script refuses to run in production. The password for all of them is `Theta@12345`.

| Role       | Email                      | Can open                                                                      |
| ---------- | -------------------------- | ----------------------------------------------------------------------------- |
| Admin      | `admin@theta.example`      | Everything                                                                    |
| Counsellor | `counsellor@theta.example` | Dashboard, leads, students, applications, courses, tasks, communication       |
| Accounts   | `accounts@theta.example`   | Dashboard, students, fees                                                     |
| Viewer     | `viewer@theta.example`     | Dashboard                                                                     |

## Scripts

| Command             | What it does                 |
| ------------------- | ---------------------------- |
| `npm run dev`       | Starts the development server |
| `npm run build`     | Creates a production build   |
| `npm run start`     | Runs the production build    |
| `npm run lint`      | Runs ESLint                  |
| `npm run typecheck` | Runs the TypeScript compiler |
| `npm run db:push`   | Applies the Prisma schema    |
| `npm run seed`      | Adds the demo data           |

## Project structure

```
prisma/                 Database schema and seed script
src/app/(auth)/         Sign-in page
src/app/(app)/          Signed-in pages, wrapped in the app layout
src/components/layout/  Sidebar, top bar, command palette, menus
src/components/shared/  Reusable pieces such as empty states and avatars
src/components/ui/      shadcn/ui components
src/lib/modules.ts      Navigation and which roles can open each module
src/lib/session.ts      Server-side user lookup and role checks
src/server/actions/     Server Actions
```

## How access control works

Middleware sends signed-out visitors to the sign-in page. Role checks happen on the server in `src/lib/session.ts`, which reads the user from the database on every request. Changing someone's role or deactivating them therefore takes effect immediately.

To protect a page, call `requireModuleAccess("module-id")` at the top. To change who can open a module, edit its `roles` in `src/lib/modules.ts`.
