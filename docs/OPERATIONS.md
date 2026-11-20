# Operations and recovery

## Deployment topology

The project is deployed; the committed GitHub Actions workflow targets AWS EC2 in `ap-south-1` and checks `https://payraport.duckdns.org`. These are repository configuration values, not a fresh live availability check. The server checkout is `/home/ec2-user/ems`. Compose runs PostgreSQL, the API and Nginx, with published ports bound to loopback. Host-managed HTTPS proxy configuration is outside this repository.

Use the Compose project name **`ems`** on the deployed host. Named volumes hold `postgres_data` and `profile_images`; changing the project name can attach different volumes and make records appear missing.

## Release workflow

`.github/workflows/ci.yml` verifies tests, lint, types and builds. On a successful push to `main`, deployment obtains temporary AWS credentials via OIDC, verifies the SSH host key, temporarily allows the runner IP on SSH, transfers source, builds API/web images, and restarts only API/web services. It checks local readiness and web responses, then the public HTTPS endpoints. Cleanup revokes temporary SSH access; a lost runner can require manual cleanup.

Required GitHub secrets are `AWS_ROLE_ARN`, `EC2_HOST`, `EC2_USER`, `EC2_SECURITY_GROUP_ID`, `EC2_SSH_KEY` and `EC2_KNOWN_HOSTS`. Keep their values private. Source transfer excludes `.env*`, storage, backups and host Caddy configuration. Root transfer does not remove obsolete docs automatically; only managed `apps/` and `packages/` source trees use deletion synchronization.

The pipeline does **not** apply schema changes or seed data. For a schema-changing release, back up first, review SQL against the deployed schema, and plan compatibility and execution order before pushing. Do not run administrator/demo seed commands on an established deployment.

## Host configuration and diagnostics

Confirm the private host `.env` has the correct credentials, strong session secret, external `WEB_ORIGIN` and `SESSION_COOKIE_SECURE=true`. Check the complete HTTPS proxy chain and browser cookie behavior after any proxy change; see [Security](SECURITY.md).

From the server checkout:

```sh
sudo docker compose -p ems ps
sudo docker compose -p ems logs --tail=100 api web
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/ready
curl -fsS https://payraport.duckdns.org/api/v1/ready
```

Health confirms the process responds. Readiness confirms database connectivity **and** that the schema has what this release needs (the administrator-scope columns and constraint); if the database is behind the release it returns 503 and the API log says which migration to apply. Readiness does not exercise every business workflow. Avoid copying personal data or secrets from logs into public reports.

| Symptom                                                         | Check                                                                                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Public URL fails, loopback works                                | Host proxy, certificate, DNS and firewall                                                                                   |
| API readiness fails                                             | Database health, credentials, network and API logs                                                                          |
| Sign-in succeeds but session disappears                         | Secure cookie/proxy protocol, origin and session secret consistency                                                         |
| CSRF/origin rejection                                           | Exact `WEB_ORIGIN`, fresh CSRF token and session cookie                                                                     |
| Data appears missing after restart                              | Compose project name, volume attachment and database name                                                                   |
| Photos missing                                                  | Image volume attachment, permissions and database key references                                                            |
| New endpoint reports database errors                            | Release/schema compatibility; deployment does not migrate schema                                                            |
| Pages fail to load data and sign-in fails right after a release | `docker compose -p ems logs api` for `column ... does not exist` or `STARTUP CHECK FAILED`; apply the migration (see below) |

## Backup and restore

Back up PostgreSQL and profile images together: employee records reference image keys. Store backups privately, encrypted where supported, outside the host failure domain. Document retention, schedule and restore ownership in the deployment's private runbook; no automated backup system is defined here.

A database dump can be captured on the host using the container's configured credentials:

```sh
sudo docker compose -p ems exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /secure/backup/path/ems.dump
```

Replace the output path with an existing protected backup location. A database dump alone does not include profile images, private environment configuration or host TLS configuration. Quiesce writes when taking a coordinated database/image snapshot. Verify backup exit status, protect output permissions and rehearse restore in an isolated environment before relying on it.

During recovery, restore the database and corresponding image snapshot to the intended volumes, restore private configuration securely, start compatible application images, then verify readiness, both-role sign-in, photos, exports and record counts. Do not practice restores against the live database.

## Rollback and outages

Preserve the failed release's logs and identify the last known good commit. Rebuild/redeploy that revision using the existing project name and volumes. The pipeline does not maintain a documented immutable-image rollback catalog. Application rollback is safe only when the previous code remains compatible with the current schema; database rollback needs a separately reviewed recovery plan.

Never use `docker compose down -v` to troubleshoot: it deletes persistent volumes. Ordinary `down` retains volumes but still stops service. Coordinate outages and avoid restarting the database unnecessarily. After recovery, verify the public HTTPS path and remove any temporary SSH firewall rules left by interrupted deployment jobs.

## Day-off calendar maintenance

Keep the configured public holidays complete for the period from each employee’s joining date to today. The app does not fetch an official Bangladesh holiday feed. Fridays and Saturdays are excluded automatically. Set missing joining dates through employee profiles; balances remain unavailable until set. Changes to joining dates, holidays, or leave records recalculate balances immediately, without changing historical stored leave totals. This feature needs no schema migration or accrual cron job. Old leave records may show totals using the previous calendar rule; the balance uses the new weekday/holiday rule on their actual date ranges.

## Administrator scopes: manual migration and deployment order

CI/CD **does not run database migrations**. Do not run `db:setup` or seed scripts
against production to apply this change. Use the reviewed migration
`apps/api/src/db/migrations/001_admin_scopes.sql` against the intended database.
No production migration or deployment is performed by this code change.

1. Back up the database and verify the restore procedure. Schedule a maintenance
   window and stop/drain **all old API instances and background writers**. The
   old API treats every ADMIN as unrestricted and must never serve a department
   administrator. Avoid a mixed-version rolling deployment for this release.
2. Run the migration with the database owner's migration credentials, for example
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/src/db/migrations/001_admin_scopes.sql`.
   It runs in one transaction: adds the separate scope/department columns, sets
   every existing ADMIN to FULL, removes `users_single_admin_idx`, and validates
   role/scope consistency and the department foreign key. Existing employees,
   passwords, related records and sessions are preserved. It can be rerun safely;
   it does not overwrite an already assigned scope. An invalid existing row
   aborts the entire transaction; investigate rather than removing constraints.
3. Verify existing admins have `admin_scope='FULL'` and no administered department,
   employees have neither scope nor administered department, and the unique
   single-admin index is absent. Deploy the new API and web build together.
4. Smoke-test full-admin sign-in, employee personal features, and a department
   admin's blocked cross-department direct API request. Only then reopen traffic
   and start assigning scopes through the employee record's Administrator access
   form. Keep at least one active full-access administrator.

Rollback: keep maintenance mode on. Do **not** run the old API while any
DEPARTMENT administrators exist: it would elevate their access. Prefer rolling
forward. If rollback is unavoidable, use the new API to revoke the additional
admin permissions with an audit trail first, check that the old single-admin
assumption holds, then deploy the old application. Do not drop columns or delete
employee data to roll back. Restoring a backup also discards changes since that
backup and needs a separate operational decision.

Authorization is read from `users` on every authenticated request; sessions store
only the user ID, not roles or scopes. Permission changes apply to the next
request without requiring a new login. Access changes remove the target's import
previews, and every commit revalidates current scope and current employee
membership. The browser refreshes permissions on focus, after assignment, and
periodically, clearing its workspace cache when the scope changes. Already
completed downloads cannot be recalled. In-flight requests that have already
passed authorization may complete; subsequent requests use the new permission.

### Root administrator (second migration)

One account is the **root administrator** (`users.is_root`). Only the root can grant,
change or revoke administrator access, and its own access cannot be changed through the
application. A full-access administrator the root creates has every operational permission
(all departments, employees, imports/exports, settings) but cannot assign or change
administrator access and cannot modify the root account. Department admins remain limited
to their department. Every assignment is audited with actor, target, level and department.

Deployment order (CI/CD still does not run migrations; apply on the server, then deploy):

1. Back up the database.
2. Make sure `001_admin_scopes.sql` has been applied, then run
   `apps/api/src/db/migrations/002_root_admin.sql` the same way (`psql ... -v ON_ERROR_STOP=1 -f`).
   It adds `is_root`, marks the **oldest active full-access administrator** as root only when
   no root exists yet, and adds a check (root must be a full-access admin) and a unique index
   (at most one root). It is repeatable and never moves an existing root.
3. Verify before deploying:
   `SELECT u.id, e.official_employee_id, u.admin_scope, u.is_root FROM users u LEFT JOIN employees e ON e.id=u.employee_id WHERE u.role='ADMIN' ORDER BY u.created_at;`
   Exactly one row must have `is_root = t` and it must be the original administrator.
4. Deploy the API and web build together. Until step 2 is applied, `/api/v1/ready` reports
   `users.is_root` missing and the new API fails requests.

If the wrong account was chosen, move the root in one transaction (the unique index requires
clearing the old root first):
`BEGIN; UPDATE users SET is_root=FALSE WHERE is_root; UPDATE users SET is_root=TRUE WHERE id='<user id>'; COMMIT;`
The new root must be an active ADMIN with `admin_scope='FULL'`. Never run an API build older than
this release against the migrated database for administrator management: it ignores `is_root`.

### If a release was deployed before the migration

Symptom: the site loads (an old session cookie still shows the app shell), but pages such as
Leave fail to fetch data and signing in fails. Cause: the new API selects `users.admin_scope`
and `users.administered_department_id` on every authenticated request and on sign-in; without
the migration PostgreSQL reports `column "admin_scope" does not exist` and the API answers 500.
`/api/v1/ready` returns 503 for this state and the API logs `STARTUP CHECK FAILED`.

Recovery on the server (back up first; the migration is transactional and repeatable):

```sh
cd /home/ec2-user/ems
sudo docker compose -p ems logs --tail=200 api | grep -E "does not exist|STARTUP CHECK|schema is behind"
sudo docker compose -p ems exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/ems-pre-scope-migration.dump
sudo docker compose -p ems exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' \
  < apps/api/src/db/migrations/001_admin_scopes.sql
sudo docker compose -p ems exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT role, admin_scope, count(*) FROM users GROUP BY 1,2"'
curl -fsS http://127.0.0.1:3000/api/v1/ready
```

Readiness turns green on its own once the migration is applied. Then restart the API
(`sudo docker compose -p ems restart api`) to clear its in-memory sign-in rate limiter:
failed requests, including 500s, count toward the limit of 10 per 15 minutes per IP, so
repeated attempts made while the schema was behind can leave valid users temporarily locked out.
Existing sessions stay valid because they store only the user ID.

To check for a leftover single-administrator restriction (the migration removes any unique
index or constraint on `users` that depends on `role`, whatever its name):

```sh
sudo docker compose -p ems exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d users"'
```
