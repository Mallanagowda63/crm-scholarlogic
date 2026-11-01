# Go-live checklist

Everything that must be done before ScholarLogic goes into production. This is updated at the end of every phase.

*Last updated: Phase 3.*

## Security upgrades

`npm audit` reports 24 warnings (4 high, 18 moderate, 2 low). The fixes need breaking upgrades, so they were deferred.

- [ ] Upgrade to **Next 16**. This fixes the high-severity `postcss` warning.
- [ ] Upgrade to **Prisma 7**. This fixes the high-severity `prisma`, `@prisma/config` and `deepmerge-ts` warnings.
- [ ] Upgrade ESLint and `eslint-config-next`. This fixes `minimatch` and related warnings in development tools.
- [ ] Update or remove the `shadcn` package. This fixes the `deepmerge` and `ts-morph` warnings. Check first that `globals.css` no longer needs `shadcn/tailwind.css`.
- [ ] Rerun `npm audit` and `npm test` after these upgrades.
- [ ] Resolve the **`jose` build warning** (`CompressionStream` isn't supported in the Edge Runtime), which comes from Auth.js. Sign-in works with it, so check that it's gone after upgrading, or confirm it's harmless on the chosen host.

## Hosting and access

- [ ] Put the app behind a **trusted proxy that sets `x-forwarded-for`**, and make sure clients can't supply their own value. Until then, clients can forge their IP address, and only the limit of 20 failures per email reliably stops password guessing.
- [ ] Use HTTPS.
- [ ] Run on Node.js 22 or newer.
- [ ] Generate a new `AUTH_SECRET` for production. Don't reuse the development one.
- [ ] Set `AUTH_TRUST_HOST` only if the host requires it.

## Database

- [ ] Use a managed or properly secured Postgres with a strong, unique password.
- [ ] Set up automatic backups, and test restoring one.
- [ ] Apply the schema with `npm run db:deploy`. Never run `npm run seed` in production, because it erases data.
- [ ] Confirm the delete-blocking triggers exist on `Student`, `Admission`, `Payment`, `FeePlan`, `Instalment` and `Receipt`.

## Real data

- [ ] Replace the sample **course fees** and instalment plans with Theta's real ones.
- [ ] Confirm the **GST rate**. The sample data assumes 18% on every course.
- [ ] Replace the sample **GSTIN**, legal name, address, phone and email in `OrgSettings`.
- [ ] Replace the sample **branches** (Koramangala and Indiranagar) with Theta's real centres.
- [ ] Review the sample pipeline stages, lead sources, target exams and message templates.
- [ ] **Create the first real admin account.** The seed script is the only way to create users today and it refuses to run in production, so this needs a one-off script until user management arrives in Phase 8.
- [ ] Remove the demo accounts and all sample records, which use `@theta.example` and `@example.com` addresses and made-up phone numbers.

## Before launch

- [ ] Run `npm test` against the release build, and make sure everything passes.
- [ ] Confirm there's a lawful basis and a retention policy for students' and parents' personal data, including minors, under India's data protection law. Student records are never hard-deleted by design, so decide how to handle erasure requests.
