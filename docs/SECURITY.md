# Security

## Cloudflare demo

- The browser selects one of five fictional personas. D1 enforces root, full-administrator, department-administrator and employee permissions. An employee's self-service identity comes from its session. Administrator assignment requires an active root session. Persona switching is an intentional demo capability inside the same isolated workspace.
- The host-only session cookie is Secure, HttpOnly and SameSite=Lax. The Worker stores a SHA-256 digest of the opaque session token and a separate CSRF token in D1. Session and CSRF credentials rotate on persona switch and reset. Credential rotation, expiry and workspace ownership are checked on protected writes.
- Workspace IDs scope primary and foreign keys and query predicates. Protected write batches recheck actor session, target scope and any expected record version before auditing a mutation. Imports use expiring, actor-bound previews and revalidation before a single commit.
- IP rate-limit bindings are approximate per Cloudflare location. The database separately enforces the UTC issuance budget, retained workspace limit, expiry, image limits and workspace activity cap. Scheduled cleanup removes expired data. A workspace remains inaccessible as soon as it expires.
- The deployed runtime exposes the SPA and explicit API routes, including simple health and readiness probes. Debug tooling and D1 exploration are local. The generated staging configuration starts with both routes off. Its hosted test uses Cloudflare Access and fictional data. [Staging runbook](OPERATIONS.md#controlled-cloudflare-free-staging)

## Node/PostgreSQL reference security

### Access model

The API is the authorization boundary. Administrators manage employee records and operational workflows. Employees can read their own profile and leave history, manage their own photo, propose changes and export their own permitted data. Never rely on hidden navigation or frontend role checks to protect a route.

`auth/middleware.ts` loads current user/account/employment state on protected requests. First-login accounts must complete the password change before normal protected actions. Employee identity for self-service must come from the authenticated session rather than caller-supplied IDs.

### Implemented controls

- bcrypt password hashing with configurable cost (10–15); new passwords require at least 12 characters and at most 72 UTF-8 bytes.
- Random temporary passwords, forced first-login change, generic login failures and dummy hashing for unknown users.
- PostgreSQL-backed sessions, HttpOnly/SameSite=Lax cookies, login session regeneration, and session deletion on password changes/resets.
- Session-bound CSRF tokens for unsafe methods, configured-origin CORS, and login/password/reset rate limits.
- Input schemas, parameterized query values, bounded payloads and public error sanitization. Dynamic SQL identifiers must continue to come from internal field/section mappings.
- Private, random-key profile images restricted to owner/admin delivery; accepted JPEG/PNG/WebP signatures and a 5 MB limit.
- CSV formula escaping, XLSX formula/external-content rejection, row/cell/expanded-content bounds, actor-bound expiring import previews and commit revalidation.
- Audit events for sensitive record actions. Preserve the existing practice of avoiding raw field values, passwords and image contents in audit metadata.

These controls do not constitute a penetration test or certification.

### Open hardening items

The source review identified the following items. They remain open; writing this guide does not fix them or verify the live host configuration.

| Priority                    | Gap                                                                        | Required improvement                                                       |
| --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| High when HTTP is reachable | `SESSION_COOKIE_SECURE` defaults to false, including in production Compose | Enforce HTTPS and reject insecure production cookie settings               |
| Medium                      | Login throttling is IP-based with process-local counters                   | Add account-aware throttling and a shared store for multiple API instances |
| Medium                      | Rolling sessions have no fixed lifetime from login                         | Store an authenticated-at timestamp and enforce absolute expiry            |
| Medium                      | Temporary passwords have no expiry timestamp                               | Persist and validate a short validity period during login                  |

Image verification checks signatures rather than fully decoding/re-encoding images. Evaluate dimension limits, metadata removal and stronger validation if upload requirements expand. MFA is not implemented. Dependency vulnerability status and host/TLS security require separate review.

### Local reference configuration

Use a fresh high-entropy session secret and private database credentials; never commit `.env`, credential exports or personal data. Set `WEB_ORIGIN` to the exact external HTTPS origin and `SESSION_COOKIE_SECURE=true`. Confirm cookie issuance through the actual proxy chain: Express trusts one proxy hop in production, while Nginx sets forwarded protocol from its incoming scheme. An additional host TLS proxy requires end-to-end verification of this behavior.

Keep API and database ports private and use a least-privilege runtime database role. Protect database and image backups with access controls and encryption. Define retention and restore ownership outside the application.

## Reporting and response

Report suspected issues privately to the repository/deployment owner. Include affected endpoints, role, reproducible steps using fictional data and impact; omit passwords, session cookies and employee exports from public issues.

For an incident, restrict affected access, preserve relevant logs, revoke affected sessions and rotate compromised credentials. Correct the cause, add a regression test and verify recovery through the public URL. Rotating `SESSION_SECRET` invalidates existing signed session cookies and requires users to sign in again.

## Review checklist for code changes

Test unauthenticated access, wrong-role access, another employee's identifiers and first-login restrictions. Check CSRF handling, strict input fields, transaction/audit behavior and safe errors. New export fields require an explicit masking and access decision. New logs must not expose secrets or unnecessary personal data.

## Scoped administrators

`users.role` remains ADMIN or EMPLOYEE. ADMIN additionally requires `admin_scope`
(FULL or DEPARTMENT); DEPARTMENT requires exactly one valid
`administered_department_id`, independent of `employees.department_id`. No ADMIN
scope is inferred from the employee's own department. Unknown/missing scopes fail
closed in the authorization helpers. The database rejects inconsistent values.

The ADMIN route gate applies `authorizeAdminRequest` for employee-ID, leave-ID,
request-ID and department targets. Collection SQL applies `employeeScopeSql`
before pagination/counts/aggregation. Department administrators cannot administer
any ADMIN account (including themselves); personal `/me` endpoints resolve only
the session's linked employee and retain employee features. Employee transfers
are full-admin-only. Related records follow their owner's current department,
not the department at the time the record was created.

Audit of existing ADMIN checks:

| Surface                                                          | Authorization                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Employee lists/search/counts, overview, balances                 | Department predicate and administrator exclusion before limit/aggregation                    |
| Employee detail, spouse, PDS, status, password reset             | Central target guard; mutation checks repeated with employee row locked                      |
| Image upload/delete/delivery                                     | Scoped employee guard; session-owned personal image is separate                              |
| Change requests and leave                                        | Scoped list joins; ID resolution to employee; locked mutation check                          |
| CSV/XLSX/PDS exports                                             | Scoped employee selection before limit; child records only for selected owners               |
| JSON/file import preview and commit                              | Assigned department validation; existing targets scoped; commit revalidation under row locks |
| Departments, global holiday/leave settings, global audit history | Explicit FULL-only gate                                                                      |
| Admin access assignment/change/revocation                        | Explicit FULL-only gate; serialized updates, last-full-admin protection, transactional audit |
| Personal profile/leave/requests/images/exports                   | Session-linked employee, independent of administered department                              |

Every administrator access write records actor user ID/role, target user ID,
employee ID, previous/new scope and previous/new administered department in the
same transaction. Normal employee/profile/import endpoints cannot write role or
admin scope. For future routes, use the scope helpers and add direct-API negative
tests; an ADMIN role check alone is insufficient. Global audit history is kept
full-admin-only because it includes cross-department identities.
