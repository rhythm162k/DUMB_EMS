# Upload / download fixes — hand-off

Paste this file into a new chat together with ems.zip if the limit ends.
Delivery rule: send only new/changed files in the same folder structure, as a zip to merge.

## Reported problems

1. Admin access (Full / Department): success message vanishes right away; the save itself works.
2. Upload does not accept .xlsx (only .csv).
3. Wrong department UUID in the upload shows the confusing "This information has changed. Refresh the page and try again."
4. Wanted: a template button (Excel / CSV) with the exact import fields, import rules and department UUIDs.

## Part 1 — DONE

- (1) Cause: `EmployeeDetailPage` used the access values in the `key` of `AdminAccessForm`, so the form was remounted after the refresh and its success state was lost. Key is now `employee.id`; the form follows new props without remounting.
- (2) Cause: `readXlsx` refused every `.bin` file (Excel adds `printerSettings*.bin`), failed on styled empty trailing cells, and any reader error became the generic "could not be opened". Fixed in `apps/api/src/data/spreadsheets.ts`. Also: date serial numbers become YYYY-MM-DD, rich-text shared strings are read cleanly, trailing empty CSV/Excel columns are ignored, guide sheets named `Instructions`, `Import rules`, `Departments` are skipped. The upload route now decides CSV vs XLSX from the file content, not the browser's label.
- (3) New `apps/api/src/data/import-messages.ts` turns validation problems into plain sentences ("Invalid data entry. The department ID must be the exact ID (UUID)...") shown per row in the preview. Commit-time database refusals (bad UUID, wrong format) now answer "Invalid data entry...". New messages are in both public-error lists and have Bangla text.
- Tests: `tests/import-friendly.test.ts` (added to `vitest.public.config.ts`).

## Part 2 — DONE (code written; not yet run on a full install, see "Left")

Template download, `GET /admin/data/template?format=xlsx|csv`. Work was split in two: A = server (bigger), B = web + text.

### A. Server

- New `apps/api/src/data/import-template.ts`: builds the template. Guide sheets keep the exact names `Instructions`, `Import rules`, `Departments`. Exports `IMPORT_RULES` (the 12 rows, exact wording), `INSTRUCTION_LINES` (English + a short Bangla block), `templateSheets()`, `templateCsv()`, `csvTemplateColumns()`.
  - `Import rules`: columns "Field or feature" / "What you need to know".
  - `Departments`: columns "Department" / "Department UUID". The route reads active departments from the database (`departmentScope` for a department admin). Nothing is hard-coded.
  - One sample row on PROFILE, SPOUSE and every record sheet. Employee ID is `SAMPLE-000001`; the department in the sample rows is the first department the admin may use.
  - Data sheets contain only importable columns (controls + the fields), not the export-only `employmentStatus`, `departmentNameEn`, `departmentNameBn`.
  - Text format on: officialEmployeeId, recordId, expectedUpdatedAt, phone, nationalId, spouseNationalId, membershipNumber, orderReference (also on the empty cells below the header).
  - CSV: one header row (controls, profile fields, then spouse and record fields, shared keys once) + the PROFILE sample row.
- Sample rows can never be saved: new `apps/api/src/data/sample.ts`; `validateImport` (records.ts) rejects any row whose employee ID starts with `SAMPLE-` (case-insensitive) before any database lookup, at preview and at commit. New row message in `import-messages.ts` (in `importRowMessages`, Bangla in plain-bn.ts). It is a preview-row message, not an HTTP error, so `publicMessages` (API and web lists) did not change.
- `spreadsheets.ts`: `Sheet` has an optional `format` (text columns, widths, wrap). Sheets without it are written exactly as before. `readXlsxSheets()` reads every sheet incl. the guides (used by tests); `readXlsx()` still skips the guide sheets.
- Route now only loads departments and calls the builder.
- Tests: `apps/api/test/data-workbooks.test.ts` (database): sheets, exact rules, departments equal to the database (inactive ones left out), text format, CSV, sample rows blocked / accepted after the ID is replaced, department-scoped admin, access control. `tests/import-template.test.ts` (no database, added to `vitest.public.config.ts`).

### B. Web + text

- `DataToolsPage.tsx`: the two template buttons are rendered from one list, so they are identical: "Download Excel template (.xlsx)" and "Download CSV template (.csv)"; both show "Download started." like the other downloads. Two new help sentences (sample row; CSV drops leading zeros in Excel).
- `plain-bn.ts`: Bangla for both buttons, both help sentences and the sample-row message.

## Left

- Run: `npm run format`, `npm run typecheck`, `npm run lint`, `npm run test:public`, `npm test` (the full tests need the test database).
- Nothing could be run with the real dependencies while writing this (no install, no PostgreSQL). Checked only with a separate TypeScript/zod install: the template builder, the 8 sample rows against the real zod schemas (valid once the ID is replaced, blocked as-is), the .xlsx opened with openpyxl. The database tests, the public tests, `tsc`, eslint, prettier and the browser UI were NOT run.
- Look at the page once in the browser (Bangla and English): button size/wrap on a narrow screen, and open the downloaded .xlsx in Excel.
- No database migration is needed for either part.
