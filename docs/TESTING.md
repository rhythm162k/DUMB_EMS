# Testing

## Validation layers

Run from the repository root:

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm run test:public
```

`test:public` uses `vitest.public.config.ts`: public-error responses, spreadsheet parsing and import validation. It needs neither database credentials nor a running development server. The public-error tests bind a local HTTP port.

The complete suite uses `vitest.config.ts`, loads `.env.test` and runs files sequentially against one isolated PostgreSQL database. It starts the Express app on ephemeral ports; the development API need not be running.

## Prepare the integration database

```sh
cp .env.test.example .env.test
docker compose up -d db
```

Set test credentials to match your local PostgreSQL instance. Keep `NODE_ENV=test` and a separate database such as `ems_test`. Create that database once, substituting your configured database user:

```sh
docker exec ems-db psql -U YOUR_POSTGRES_USER -d postgres -c 'CREATE DATABASE ems_test;'
npm test
```

The setup refuses an environment without `NODE_ENV=test` or a database name with a distinct `test` segment. Fixtures truncate test tables; the name check is not a substitute for verifying the actual target. Never point `.env.test` at deployed data. Image tests use a temporary directory.

## Coverage and adding tests

Tests live in `apps/api/test/` and `tests/`. Existing suites cover auth/session lifecycle, CSRF/CORS, roles and ownership, employee/department/PDS/spouse workflows, private photos, requests, leave, imports/exports, spreadsheet bounds and sanitized errors. Coverage is determined by the current test files, not a promise that every path is tested.

For route changes, use fictional fixtures from `apps/api/test/helpers/`, call the real Express app and assert the response plus important database effects. Include wrong-role/other-employee cases for access changes. Spreadsheet unit tests and mocked import validation do not replace PostgreSQL integration coverage.

CI runs the full tests, lint, typecheck and build on pull requests and pushes to `main`. A successful push to `main` also triggers the deployment job after verification; see [Operations](OPERATIONS.md).

## Manual acceptance

No browser end-to-end suite is configured. Before releasing a workflow change, verify:

- Admin and employee sign-in, forced password change, logout and reset behavior.
- Direct API denial for another employee's ID and admin-only actions.
- Profile/PDS editing, proposals, review conflicts and audit outcomes.
- Photo upload, replacement/removal and denial of stale/foreign image URLs.
- Leave calculations with configured holidays, overlap rejection and correction/cancellation reasons.
- CSV/XLSX exports, masking, import preview errors, selected commit rows, expired/replayed previews and stale updates.
- Phone/desktop navigation, keyboard focus, both languages, empty/error states and downloads.

Repeat auth/CSRF and health checks through the deployed HTTPS URL after release. Record actual test results and limitations in the pull request or release record; do not infer live verification from a build passing.

## Day-off balances

`apps/api/test/day-off-balances.test.ts` covers 11-day accrual thresholds, carry-forward/advance use, joining dates, Friday/Saturday exclusions, holiday overlap, all leave types, future leave, corrections/cancellations, filtering and role/ownership boundaries. Run it with `npm test -- apps/api/test/day-off-balances.test.ts`. Manually verify the balance table on the leave page in both roles and languages.

## Administrator scope regressions

`admin-scopes.test.ts` exercises full-access, department and employee sessions:
assignment validation/audit, current-department lists and counts, direct ID
tampering, administrator protection, global settings, related records, leave,
requests, private images, CSV/XLSX exports/imports, personal features, employee
transfers, preview invalidation and existing-session permission changes.
`admin-scope-migration.test.ts` builds a legacy schema in a temporary schema in
the test database, checks preservation and removal of the single-admin limit,
and reruns the migration against already-scoped accounts.
`admin-schema-check.test.ts` covers the readiness schema check (an un-migrated schema
is reported as behind the release and is clean after migrating) and proves the migration
removes a single-administrator restriction under any name, in index or constraint form,
without touching unrelated unique indexes.
