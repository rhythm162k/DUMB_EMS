# Development

## Local setup

Use Node.js 26.13.1+ in the 26.x LTS line and its bundled npm 11.20+ in the 11.x line. `.nvmrc` records the Node major used by CI. Run all commands below from the repository root.

```sh
cp .env.example .env
npm ci
```

Replace placeholder credentials and generate `SESSION_SECRET` using `openssl rand -base64 48`. Start a new local database and initialize it:

```sh
docker compose up -d db
npm run db:setup
npm run db:seed
npm run auth:seed-admin -- 000001 "Local Administrator"
npm run dev
```

The generated temporary password is printed once. Change it at first sign-in. Admin seeding refuses to replace an existing administrator. Use fictional local fixtures. The optional `db:seed-demo` script creates fictional accounts and a credential file; inspect its options and keep that output private. Do not run it against a deployed database.

## Configuration

The API loads the root `.env` and validates it in `apps/api/src/config/env.ts`. Compose overrides selected settings for container networking.

| Variable                                            | Meaning                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`, `PORT`                                  | Runtime mode and API port                                           |
| `POSTGRES_HOST`, `POSTGRES_PORT`                    | Local defaults are `127.0.0.1:5433`; API container uses `db:5432`   |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database connection credentials/name                                |
| `SESSION_SECRET`                                    | Required at startup; minimum 32 characters, generated randomly      |
| `SESSION_COOKIE_SECURE`                             | False for local HTTP; true for deployed HTTPS                       |
| `SESSION_MAX_AGE_HOURS`                             | Rolling session window, 1–168 hours; default 8                      |
| `BCRYPT_COST`                                       | Cost 10–15; default 12                                              |
| `WEB_ORIGIN`                                        | Exact allowed browser origin; local default `http://localhost:5173` |
| `PROFILE_IMAGE_DIR`                                 | Private image folder; local default `storage/profile-images`        |

The frontend calls relative API URLs. Keep the Vite/Nginx proxy aligned with `/api/`; do not embed credentials or server secrets in browser code.

## Make a change

1. Locate the workflow using [Architecture](ARCHITECTURE.md). Read its validation, route, repository and UI together.
2. Preserve server authorization and field allowlists. For new fields, consider serialization, masking, audit metadata, imports/exports and translations.
3. Keep database writes and related audit events transactional. Review schema changes for existing data and plan deployment separately.
4. Add focused regression coverage for changed behavior and run the checks in [Testing](TESTING.md).
5. Update the relevant guide and describe behavior, validation and operational consequences in the pull request.

Use `npm ci` for reproducible installs. Commit `package-lock.json` when dependencies change. Production Docker builds use the lockfile and compile the API/web workspaces; validate a full root build before release.

## Useful commands

| Command                               | Purpose                                            |
| ------------------------------------- | -------------------------------------------------- |
| `npm run dev`                         | API watcher and Vite together                      |
| `npm run dev:api` / `npm run dev:web` | Individual development processes                   |
| `npm run lint`                        | Repository lint rules                              |
| `npm run typecheck`                   | Shared/API/web type checks                         |
| `npm run build`                       | Shared/API/web builds                              |
| `npm run test:public`                 | Standalone regression tests without DB credentials |
| `npm test`                            | Full suite with isolated test database             |

Schema setup is not an automatic migration system. Back up and review SQL before applying it to an existing database. Avoid including generated builds, credential files, private exports or local environment values in commits.

## Day-off accrual

`apps/api/src/leave/balance.ts` owns balance queries and the one-credit-per-11-workdays calculation; `DayOffBalances.tsx` renders the employee/admin views within the leave page. Balance queries use Bangladesh dates, Friday/Saturday weekends, configured holidays, and non-cancelled leave of every type. Do not introduce a second stored balance: corrections, holiday updates and joining-date edits must stay consistent. This is calendar/leave-record accounting, not an attendance integration; unrecorded absences cannot be inferred.
