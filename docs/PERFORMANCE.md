# Phase 5 performance and D1 capacity

Measured on 21 November 2026 with Wrangler 4.156.0, local workerd, and a fresh migrated D1 database. The baseline was the Phase 4 source before optimization. The final run includes the retained-workspace storage guard. The runs used warmed endpoints and the same synthetic API payloads. Chrome separately exercised real CSV/XLSX file processing and the browser photo encoder.

## Request measurements

All time values are milliseconds. Sample count applies to each before and after run. **Process mean** divides cumulative CPU across the local workerd processes by the number of requests with the profiler off. It includes local runtime and D1 simulator work and has coarse process-clock resolution. **V8 active estimates** sum the profiler sample intervals attributed to active frames for each individual request, including native frames sampled inside V8. These estimates can include profiler and simulator costs and are sensitive to scheduling. The local invocation trace reported zero timing, so billed or enforcement CPU by request is unavailable locally. **D1 wait** is elapsed time around the actual D1 binding calls in a separate, locally instrumented build. It includes SQL and binding transport and uses the Worker's millisecond clock.

| Operation                                |   n | Process mean before → after | V8 mean / p95 / max before | V8 mean / p95 / max after | HTTP p95 after | D1 calls / mean wait |
| ---------------------------------------- | --: | --------------------------: | -------------------------: | ------------------------: | -------------: | -------------------: |
| Create workspace                         |  22 |                 6.36 → 6.82 |         6.48 / 8.83 / 8.89 |        5.43 / 7.02 / 9.28 |           9.84 |             1 / 2.91 |
| Switch persona                           |  20 |                 5.00 → 5.00 |         4.63 / 6.11 / 7.21 |        3.87 / 5.26 / 8.84 |           6.81 |             2 / 1.25 |
| Root dashboard                           |  24 |                 4.17 → 4.58 |         3.53 / 5.07 / 5.09 |        3.88 / 6.04 / 6.93 |           6.34 |             2 / 1.21 |
| Reset workspace                          |  12 |                 6.67 → 8.33 |         6.18 / 7.64 / 7.64 |      7.15 / 11.76 / 11.76 |          11.50 |             2 / 3.92 |
| Create employee                          |  18 |                 5.56 → 6.11 |         4.70 / 6.96 / 6.96 |      6.04 / 16.28 / 16.28 |           8.71 |             3 / 2.00 |
| Edit employee                            |  18 |                 6.11 → 6.11 |         4.41 / 8.08 / 8.08 |        5.29 / 8.17 / 8.17 |           9.89 |             3 / 1.67 |
| Correct leave                            |  18 |                 6.11 → 6.11 |         5.23 / 7.14 / 7.14 |        6.04 / 8.53 / 8.53 |          12.18 |             5 / 3.17 |
| Approve profile change                   |   8 |                 6.25 → 6.25 |         4.58 / 7.01 / 7.01 |        5.39 / 6.78 / 6.78 |           7.86 |             3 / 1.50 |
| Approve leave                            |   8 |                 6.25 → 7.50 |         5.43 / 9.31 / 9.31 |      6.48 / 13.06 / 13.06 |          11.53 |             4 / 2.38 |
| Upload 187,166-byte JPEG                 |  18 |                 7.22 → 6.67 |         6.12 / 8.81 / 8.81 |        6.90 / 9.88 / 9.88 |          11.17 |             2 / 2.06 |
| Preview 12 rows, approximately 23 KiB    |   8 |                 7.50 → 7.50 |         5.81 / 7.00 / 7.00 |        5.67 / 9.95 / 9.95 |           9.54 |             3 / 2.13 |
| Commit 12 profile rows                   |   8 |                 8.75 → 8.75 |       8.32 / 11.82 / 11.82 |      8.90 / 10.79 / 10.79 |          11.46 |             4 / 4.25 |
| Prepare masked XLSX export, 58 employees |  24 |                 7.50 → 7.92 |         5.07 / 6.83 / 8.70 |        5.11 / 6.50 / 6.97 |          10.57 |             3 / 2.79 |
| Directory, 58 employees                  |  36 |                 4.72 → 5.00 |        4.61 / 9.93 / 10.44 |        4.22 / 5.74 / 9.94 |           9.08 |             2 / 1.89 |

All samples completed with the expected responses. Hosted resource-limit failures remain unmeasured. For fewer than 20 samples, nearest-rank p95 equals the observed maximum. HTTP elapsed time includes client and I/O latency. Subtracting the D1 wait or profiler cost from process CPU would not yield billed Worker CPU.

### What the profiles showed

- Node request/response adaptation, headers, streams and binding serialization appeared frequently across operations. No single application function dominated the common read paths. JSON handling and Zod validation appeared in import-preview samples. Workbook decoding and generation ran in a browser Web Worker. The API handled the same normalized payload for CSV and XLSX, so the API timings apply to both file formats.
- Repeated inspector start/stop inflated operation-window process CPU substantially. Import commit rose from 8.75 ms unprofiled to about 38 ms with sampling enabled, and first entry rose from 6.82 to 22.73 ms. Sampling exposed cost centers, but the difference between runs includes inspector activity and scheduling effects.
- Approvals combine the request and scoped employee lookup. The usual profile approval now uses three D1 calls including auth and the atomic write, down from four. Leave approval uses four, down from five. The transaction still asserts the acting session and target scope. These changes remove a binding call each. The sampled timings do not establish a dependable overall speedup.
- Profile-create batches in import commit send the large field payload to D1 once. The three other statements that use the imported profiles receive only IDs and department keys. Unprofiled process mean stayed at 8.75 ms, while the two profiled import-commit trials after the query change had 9.76 and 10.79 ms maxima, versus 11.82 ms before. The browser now aims for 120 KiB when encoding a 512 px photo. Chrome sent about 114 KiB using a generated high-detail input. The API stress sample continued to use a 187,166-byte JPEG.
- The controlled staging test should prioritize import commit, near-limit photo uploads, leave approval, reset and export with a full workspace. Include colder samples for employee creation, which showed an isolated local profiler spike. The smallest next change if imports miss the CPU target is to stage a server-validated, bounded mutation plan during preview and apply it in one guarded D1 batch. The final commit must still check current scope, preview ownership and expiry, target versions, and atomic rollback. Keep the existing preview/commit workflow while measuring this need.

## Fixture sizing

The 30-person fixture is a benchmark input outside the migrations directory. It adds 20 fictional staff and their accounts across three new departments. Both runs used the same seven existing PDS examples, holidays, leave and change-request history. The experiment used the final retained-workspace guard.

| Metric                                                        | 10 employees / 3 departments | 30 employees / 6 departments |
| ------------------------------------------------------------- | ---------------------------: | ---------------------------: |
| Provision process CPU mean (22 HTTP requests)                 |                      6.82 ms |                      7.27 ms |
| Root dashboard process CPU mean (24 HTTP requests)            |                      4.58 ms |                      3.75 ms |
| Root dashboard HTTP p95                                       |                      6.34 ms |                      5.62 ms |
| Provision D1 SQL mean (24 batches)                            |                      1.54 ms |                      2.46 ms |
| Provision D1 binding elapsed mean (24 batches)                |                      4.52 ms |                      8.13 ms |
| Provision D1 reads / writes per workspace                     |                    224 / 198 |                    430 / 427 |
| Allocated SQLite storage above template, per seeded workspace |                     24.5 KiB |                       48 KiB |
| Cleanup D1 SQL / binding elapsed mean (2 batches of 12)       |               2.00 / 5.65 ms |              7.00 / 12.91 ms |
| Cleanup D1 reads / writes per batch of 12                     |                  4,487 / 552 |               25,451 / 1,068 |

Storage is the SQLite allocation delta after 24 concurrent retained workspaces with no uploads. Cleanup removed all 24 workspaces and returned the two local databases to their starting allocations. The dashboard measurements are close given host variation. The 30-person fixture more than doubled provisioning writes and materially increased cleanup work. The shipped fixture stays at 10 employees in 3 departments.

### Daily and retained-space estimates

At 120 issued workspaces, provision and later cleanup for 120 untouched visitors account for roughly **29,300 writes and 72,000 reads** with the smaller fixture. The alternate fixture would account for about **61,900 writes and 306,000 reads**. These extrapolate local D1 metadata and omit visitor edits, photo writes, reset churn, monitoring queries, variations in cleanup distribution and other uses of the same account. Cloudflare currently allows 100,000 D1 writes and 5 million reads per day on Free, with 500 MB per database. Index maintenance can add billed writes. Confirm real staging usage in D1 Metrics. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Each workspace may hold eight photos, each up to 192 KiB raw and 256 KiB as stored base64. UTC rollover could otherwise retain workspaces from two days at once. The database now caps all retained visitor workspaces, including expired ones, at 144. That caps the theoretical concurrent photo payload at **288 MiB** before SQLite pages, other records and metadata. Reset frees the current slot and creates its replacement in the same transaction. The 120-per-day issuance cap, 100-event workspace activity cap, and cleanup batches of 12 continue to bound usage. Watch shared D1 storage and row write quotas during staging.

## Reproduce locally

Run these from the project root with Node 26 and the pinned npm dependencies. The profiler uses `ps` on macOS, opens loopback ports 8792 and 9232, and creates disposable D1 databases. Run benchmarks sequentially on an otherwise idle machine.

```sh
npm run build:worker
node scripts/profile-worker.mjs
EMS_PROFILE=1 node scripts/profile-worker.mjs
node scripts/profile-worker.mjs --larger-fixture
EMS_PROFILE=1 node scripts/profile-worker.mjs --larger-fixture
node scripts/measure-d1.mjs
```

Follow the [controlled staging procedure](OPERATIONS.md#controlled-cloudflare-free-staging) to obtain the hosted CPU percentiles, resource-limit counts and D1 quota usage that determine release readiness.
