# Cloudflare demo operations

The demo serves the React/Vite build through Workers Static Assets and routes `/api/*` to Express on Workers. A dedicated D1 binding stores a fictional template, temporary visitor workspaces and profile photos. The Node/PostgreSQL reference app runs separately.

## Local verification

```sh
npm ci
npm run dev:worker
```

Open **http://127.0.0.1:8787**. The command applies local migrations and builds the Worker frontend. Run `npm run dev:web:worker` separately for Vite hot reload. `/api/v1/health` checks the runtime and `/api/v1/ready` checks the D1 schema and personas. The checked-in Wrangler configuration uses a placeholder D1 UUID and disables both the workers.dev route and version URLs.

```sh
npm run test:worker
npm run build:worker
```

See the [test guide](TESTING.md) and [performance report](PERFORMANCE.md) for scope and results.

## Controlled Cloudflare Free staging

Remote steps require explicit approval. Use a dedicated demo account or an isolated account context approved for the test. Verify Workers Free and Zero Trust Free in the dashboard. Register a workers.dev subdomain in **Workers & Pages** if the demo account needs one. Use only a separate staging Worker and a fresh D1 database. Runtime secrets and app environment variables are unnecessary. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [Cloudflare Access Free](https://www.cloudflare.com/sase/products/access/)

1. Authenticate Wrangler and confirm the intended account. Set the demo account ID in your shell for the test. Keep account identifiers and credentials out of the repository.

   ```sh
   export WRANGLER_SEND_METRICS=false CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false
   npx wrangler login
   npx wrangler whoami
   export CLOUDFLARE_ACCOUNT_ID=YOUR_DEMO_ACCOUNT_ID
   npx wrangler d1 create ems-portfolio-staging --update-config=false
   ```

2. Use the UUID of that new database. The generator keeps the checked-in configuration local and creates an ignored file with both routes disabled. The create command leaves the existing local configuration untouched.

   ```sh
   node scripts/create-staging-config.mjs YOUR_STAGING_D1_UUID
   staging=apps/api/worker/wrangler.staging.generated.json
   npm run build:worker
   npx wrangler deploy --config "$staging" --dry-run
   npx wrangler d1 migrations list DB --config "$staging" --remote
   npx wrangler d1 migrations apply DB --config "$staging" --remote
   npx wrangler d1 migrations list DB --config "$staging" --remote
   npx wrangler deploy --config "$staging"
   ```

   Confirm migrations 0001–0006 were applied. Confirm the staged Worker has zero reachable routes and no version URL. [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)

3. In **Zero Trust → Access → Applications**, add a self-hosted application for the exact hostname `ems-portfolio-staging.<account-subdomain>.workers.dev` with no path restriction. Create an **Allow** policy for the named tester emails and use the account's configured sign-in method or one-time PIN. Review the effective policy, including any inherited account rules, for a public or bypass grant. Keep routes disabled if the Access policy cannot be established first. [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

4. In the ignored staging file set `workers_dev` to `true` and keep `preview_urls` set to `false`. Deploy that file again. In a private unauthenticated browser, check both the SPA root and `/api/v1/ready` for an Access sign-in or denial. Disable the route immediately if either exposes the app without Access. Next, use an allowed tester identity to verify the persona picker and JSON `{"status":"ready"}`. Check the Worker has only the intended hostname under **Settings → Domains & Routes**. [workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

5. Record the version ID, database, UTC time range, tester region and input sizes. In **Workers & Pages → ems-portfolio-staging → Observability → Invocations**, filter to the test range and path/method. Use the invocation logs and `$workers.cpuTimeMs`, `$workers.wallTimeMs` and `$workers.outcome`. The staging configuration enables complete invocation-log sampling for the controlled test. Use the Query Builder or its raw invocation rows to compute count, mean, nearest-rank p95 and maximum for each operation. Count `exceededCpu`, `exceededMemory`, Cloudflare error 1102 pages and unexpected responses separately. Keep any exports private and omit cookies, headers, personal information and network identifiers from the report. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/) · [CPU and wall timing](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/)

### Staging acceptance

Use only fictional inputs and independent browser sessions for isolation checks. Split samples across testers and time windows to respect the entry limit of 8/minute, the write limit of 30/minute and the 120/day issuance budget. Aim for at least 20 samples per operation, including first requests after a new deployment and warm requests. Spread creation, reset and operation setup over multiple UTC days if needed. Keep setup traffic in separate time windows when it shares the measured route, for example first entry and persona switching.

| Operation                | Probe                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry, switch and reset  | `POST /api/v1/demo/session` with and without a session, then `POST /api/v1/demo/reset`. Check the secure cookie, rotated CSRF token, expired session rejection, and preservation of another visitor's data.                   |
| Dashboards and directory | `GET /api/v1/overview/stats` in each role and the employee directory with filters, paging and near-cap populated data.                                                                                                        |
| Employee creation        | `POST /api/v1/admin/employees` as root and department admin. Confirm a cross-department write fails.                                                                                                                          |
| Approvals                | Approve a profile change and leave request from the scoped queue. Repeat concurrently and confirm one succeeds with no duplicate record or audit.                                                                             |
| Photos                   | Use the browser's resized output, then a valid multipart-free raw JPEG close to 192 KiB. Check upload, visibility and oversized rejection.                                                                                    |
| CSV and XLSX             | Use both real file formats in the browser. Time preview and commit separately. Include 12 valid profile rows, a mixed PDS workbook, a near-64 KiB normalized payload, and one stale atomic rollback. Verify masked downloads. |
| Cleanup                  | Allow several sessions to expire and observe the next scheduled invocations. Check that expired sessions are rejected before cleanup and that subsequent invocations remove the expired rows.                                 |

Allow public release review only after the staged results show zero resource-limit outcomes and p95 normally at or below 8 ms for each representative operation. Investigate any individual invocation at or above 10 ms, including heavy inputs and scheduled cleanup. Confirm the Cloudflare account's **Workers Metrics → Errors** and **D1 → Metrics → Row Metrics** show acceptable usage. D1 provides rows read, rows written and database storage, while Worker metrics provide traffic, CPU and resource outcomes. Retest after changes that affect either. [Workers errors](https://developers.cloudflare.com/workers/observability/errors/) · [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)

### Rollback and recovery

Disable the workers.dev route in the staging file and redeploy, or disable the route immediately from **Settings → Domains & Routes** and sync the file afterward. Keep the Access policy in place. Close the route when the controlled test ends.

Record the deployed version using `npx wrangler deployments list --config "$staging"`. If a known-good Worker version is compatible with the current schema, use `npx wrangler rollback KNOWN_GOOD_VERSION_ID --config "$staging"` and verify the route and Access policy again. Code rollback leaves D1 data and schema at their current state. [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

Before later migrations, record `npx wrangler d1 time-travel info DB --config "$staging"` and verify the label identifies the staging database. If database recovery is needed, close the route, temporarily set `triggers.crons` to `[]` in the staging file and redeploy before restoring. With approval for the destructive restore, run `npx wrangler d1 time-travel restore DB --bookmark PRE_MIGRATION_BOOKMARK --config "$staging"`. Restore the schedule after reconciling code and schema, then reopen through Access and rerun the access and workflow checks. Free Time Travel covers seven days. For a disposable staging rebuild, bind a new empty D1 database and apply all migrations. [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

A later public release requires separate approval and its own Worker and D1 names. Review the staged measurements, source snapshot, logs sampling and route settings before creating or opening public resources. [Publication checklist](PUBLICATION.md)

For an approved public build, set `EMS_PUBLIC_ORIGIN` to the public HTTPS origin when running `npm run build:worker`. The frontend build uses it for the canonical Open Graph URL and the absolute social preview image URLs. Local builds use the same image through a local asset path. [Open Graph protocol](https://ogp.me/)
