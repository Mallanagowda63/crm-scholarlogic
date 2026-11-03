# Go-live checklist

Everything that must be done before ScholarLogic goes into production. This is updated at the end of every phase.

*Last updated: Phase 6.*

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
- [ ] Run `prisma generate` during the build. The `postinstall` script needs the `prisma` development package, so it fails with `npm install --omit=dev`.
- [ ] Generate a new `AUTH_SECRET` for production. Don't reuse the development one.
- [ ] Set `AUTH_TRUST_HOST` only if the host requires it.

## Receipts

- [ ] Receipts can't show non-Latin scripts such as Devanagari or Kannada, which appear as empty boxes. Names need to be in English letters, or a font covering those scripts needs adding to `assets/fonts`.

## Reminders

- [ ] Decide whether reminders should also go out by email, SMS or WhatsApp. Today they only appear in the notification bell, while someone has the app open or the next time they open it.
- [ ] Before renaming the **Demo Scheduled** or **Demo Attended** stages in Settings, make sure demo classes can still find them. Scheduling a demo and marking attendance move the student to those stages by name.

## Uploaded documents

These include ID proofs and school records, some belonging to minors.

- [ ] Choose where uploads are kept in production. They're on the server's disk in `UPLOAD_DIR`, which needs a persistent, backed-up disk outside the public web folder. Hosts with temporary disks need `src/server/storage.ts` changed to use object storage.
- [ ] Include uploads in backups, because database backups don't cover them.
- [ ] Decide whether to scan uploads for viruses. Today only the file type and size are checked.
- [ ] Decide how long documents are kept. Removing one in the app hides it, but keeps the file.

## Database

- [ ] Use a managed or properly secured Postgres with a strong, unique password.
- [ ] Set up automatic backups, and test restoring one.
- [ ] Apply the schema with `npm run db:deploy`. Never run `npm run seed` in production, because it erases data.
- [ ] Confirm the delete-blocking triggers exist on `Student`, `AcademicRecord`, `Document`, `Admission`, `Payment`, `FeePlan`, `Instalment` and `Receipt`.

## Real data

- [ ] Replace the sample **course fees** and instalment plans with Theta's real ones.
- [ ] Confirm the **GST rate**. The sample data assumes 18% on every course.
- [ ] Have an accountant review the **receipt format**, including the SAC code (`999293`), wording, and whether a receipt or a tax invoice is required. Receipts assume CGST and SGST, so students from other states need checking for IGST.
- [ ] Set the **receipt prefix** before the first real payment, as numbers can't be changed after that.
- [ ] Clear the sample receipts before going live, so real numbering starts at 0001.
- [ ] Replace the sample **GSTIN**, legal name, address, phone and email in `OrgSettings`.
- [ ] Replace the sample **branches** (Koramangala and Indiranagar) with Theta's real centres.
- [ ] Review the sample pipeline stages, lead sources, target exams and message templates.
- [ ] **Create the first real admin account** with `npm run create-admin`.
- [ ] Remove the demo accounts and all sample records, which use `@theta.example` and `@example.com` addresses and made-up phone numbers.

## Before launch

- [ ] Run `npm test` against the release build, and make sure everything passes.
- [ ] Confirm there's a lawful basis and a retention policy for students' and parents' personal data, including minors, under India's data protection law. Student records are never hard-deleted by design, so decide how to handle erasure requests.
