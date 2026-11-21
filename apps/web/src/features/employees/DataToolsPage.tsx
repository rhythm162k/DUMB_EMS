import { safeError } from "../../lib/public-errors";
import { sections } from "./pds-fields";
import { currentLanguage, num, tr } from "../../i18n/language";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiFileRequest, downloadData } from "../../lib/api";

type Employee = {
  id: string;
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string | null;
};
type Preview = {
  previewId: string;
  results: {
    row: number;
    valid: boolean;
    errors: string[];
    columns?: string[];
    employeeId: string;
    rowType: string;
    action: string;
  }[];
};
type Audit = {
  id: string;
  action: string;
  actorRole: string;
  entityType: string;
  occurredAt: string;
  reason: string | null;
};
// Both template buttons come from one list, so they look and behave the same.
const templateDownloads = [
  ["xlsx", "Download Excel template (.xlsx)"],
  ["csv", "Download CSV template (.csv)"],
] as const;

export default function DataToolsPage({
  admin,
  fullAdmin = false,
}: {
  admin: boolean;
  fullAdmin?: boolean;
}) {
  const demo = import.meta.env.MODE === "worker";
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const [departmentId, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState("xlsx");
  const [sensitive, setSensitive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<string | number>("");
  const [credentials, setCredentials] = useState<
    { employeeId: string; temporaryPassword: string }[]
  >([]);
  const [auditPage, setAuditPage] = useState(1);
  const [showAudit, setShowAudit] = useState(false);
  const filters = new URLSearchParams({
    q,
    ...(departmentId ? { departmentId } : {}),
    ...(status ? { employmentStatus: status } : {}),
    page: String(page),
    pageSize: "20",
  });
  const employees = useQuery({
    queryKey: ["data-employees", filters.toString()],
    enabled: admin,
    queryFn: () =>
      apiRequest<{
        items: Employee[];
        pagination: { totalPages: number; total: number };
      }>(`/admin/employees?${filters}`),
  });
  const departments = useQuery({
    queryKey: ["departments"],
    enabled: admin,
    queryFn: () =>
      apiRequest<{ departments: { id: string; nameEn: string }[] }>(
        "/departments",
      ),
  });
  const audit = useQuery({
    queryKey: ["data-audit", auditPage],
    enabled: fullAdmin && showAudit,
    queryFn: () =>
      apiRequest<{ items: Audit[] }>(`/admin/data/audit?page=${auditPage}`),
  });
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? safeError(e) : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function exportFile(scope: "all" | "filtered" | "selected") {
    if (
      sensitive &&
      !window.confirm(
        tr("Include private details in this download? This will be logged."),
      )
    )
      return;
    const params = new URLSearchParams({
      format,
      sensitive: String(sensitive),
    });
    if (scope === "selected") params.set("ids", selected.join(","));
    if (scope === "filtered") {
      if (q) params.set("q", q);
      if (departmentId) params.set("departmentId", departmentId);
      if (status) params.set("employmentStatus", status);
    }
    await downloadData(
      "/admin/data/pds",
      `ems-${scope}-pds.${format}`,
      Object.fromEntries(params),
    );
    setMessage("Download started.");
  }
  if (!admin) return null;
  return (
    <section className="workspace-page data-tools-page">
      <div className="page-heading">
        <h1>{tr("Import & export")}</h1>
        <p className="page-description">
          {tr("Import employee records or download a copy.")}
        </p>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {tr(error)}
        </p>
      )}
      {message !== "" && (
        <p role="status">
          {typeof message === "number"
            ? tr(
                message === 1
                  ? "Imported {count} row."
                  : "Imported {count} rows.",
              ).replace("{count}", num(message))
            : tr(message)}
        </p>
      )}
      <section className="form-section">
        <h2>{tr("Download employee information")}</h2>
        <div className="form-grid">
          <label>
            {tr("Search employees")}
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            {tr("Department")}
            <select
              value={departmentId}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{tr("All departments")}</option>
              {departments.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Employment status")}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{tr("All statuses")}</option>
              {[
                "ACTIVE",
                "TRANSFERRED_OUT",
                "RETIRED",
                "RESIGNED",
                "SUSPENDED",
                "DECEASED",
              ].map((s) => (
                <option key={s} value={s}>
                  {tr(s)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr("Format")}
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="xlsx">{tr("Excel (.xlsx)")}</option>
              <option value="csv">{tr("Simple spreadsheet (.csv)")}</option>
            </select>
          </label>
        </div>
        <p>
          <label>
            <input
              type="checkbox"
              checked={sensitive}
              onChange={(e) => setSensitive(e.target.checked)}
            />
            {tr(" Include private personal details (administrators only)")}
          </label>
        </p>
        <p className="field-help">
          {tr(
            "Private details stay hidden unless you choose to include them. Excel puts each part on its own sheet. The simple spreadsheet puts everything in one.",
          )}
        </p>
        {employees.isError && (
          <p role="alert">{tr(safeError(employees.error))}</p>
        )}
        {employees.isPending && (
          <p className="table-message" role="status">
            {tr("Loading employees…")}
          </p>
        )}
        {employees.isError && (
          <p className="table-message" role="alert">
            {tr(safeError(employees.error))}
          </p>
        )}
        {employees.data?.items.length === 0 && (
          <p className="table-message">
            {tr("No employees match these filters.")}
          </p>
        )}
        {!!employees.data?.items.length && (
          <div
            className="table-scroll"
            role="region"
            aria-label={tr("Employees available for export")}
            tabIndex={0}
          >
            <table className="leave-table">
              <thead>
                <tr>
                  <th>{tr("Select")}</th>
                  <th>{tr("Employee ID")}</th>
                  <th>{tr("Name")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.data?.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={tr("Select employee {id}").replace(
                          "{id}",
                          e.officialEmployeeId,
                        )}
                        checked={selected.includes(e.id)}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, e.id]
                              : ids.filter((id) => id !== e.id),
                          )
                        }
                      />
                    </td>
                    <td>{e.officialEmployeeId}</td>
                    <td>
                      {e.firstNameEn} {e.lastNameEn}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-actions">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            {tr("Previous")}
          </button>
          <span>
            {num(page)} / {num(employees.data?.pagination.totalPages || 1)}
          </span>
          <button
            disabled={page >= (employees.data?.pagination.totalPages || 1)}
            onClick={() => setPage((p) => p + 1)}
          >
            {tr("Next")}
          </button>
          <button disabled={!selected.length} onClick={() => setSelected([])}>
            {tr("Clear selection (")}
            {num(selected.length)})
          </button>
        </div>
        <div className="form-actions">
          <button
            disabled={busy || !selected.length}
            onClick={() => void run(() => exportFile("selected"))}
          >
            {tr("Download selected (")}
            {num(selected.length)})
          </button>
          <button
            disabled={busy}
            onClick={() => void run(() => exportFile("filtered"))}
          >
            {tr("Download matching employees")}
          </button>
          <button
            disabled={busy}
            onClick={() => void run(() => exportFile("all"))}
          >
            {tr("Download all")}
          </button>
        </div>
      </section>
      <section className="form-section">
        <h2>{tr("Add information from a spreadsheet")}</h2>
        <p>
          {tr(
            demo
              ? "Use the template to import up to 12 rows of sample data."
              : "Download the template and fill in the employee details. Up to 1000 rows or 2 MB per file.",
          )}
        </p>
        <div className="form-actions">
          {templateDownloads.map(([format, label]) => (
            <button
              key={format}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await downloadData(
                    `/admin/data/template?format=${format}`,
                    `ems-import-template.${format}`,
                  );
                  setMessage("Download started.");
                })
              }
            >
              {tr(label)}
            </button>
          ))}
        </div>
        <label>
          {tr("Choose a spreadsheet")}
          <span className="file-control">
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreview(null);
                setChosen([]);
                setCredentials([]);
                if (!f) return;
                void run(async () => {
                  if (
                    f.size > 2 * 1024 * 1024 ||
                    !/^.+\.(csv|xlsx)$/i.test(f.name)
                  )
                    throw new Error(
                      "Choose a spreadsheet no larger than 2 MB (.xlsx or .csv).",
                    );
                  const p = await apiFileRequest<Preview>(
                    "/admin/data/files/preview",
                    f,
                  );
                  setPreview(p);
                  setChosen(p.results.filter((r) => r.valid).map((r) => r.row));
                });
                e.target.value = "";
              }}
            />
            <span className="file-control__button" aria-hidden="true">
              {tr("Browse files")}
            </span>
          </span>
        </label>
        {preview && (
          <>
            <p>
              {tr("{valid} of {total} rows are ready to import.")
                .replace(
                  "{valid}",
                  num(preview.results.filter((row) => row.valid).length),
                )
                .replace("{total}", num(preview.results.length))}
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label={tr("Import preview")}
              tabIndex={0}
            >
              <table className="leave-table">
                <thead>
                  <tr>
                    <th>{tr("Select")}</th>
                    <th>{tr("Row")}</th>
                    <th>{tr("Employee ID")}</th>
                    <th>{tr("Section")}</th>
                    <th>{tr("Action")}</th>
                    <th>{tr("Validation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.results.map((r) => (
                    <tr key={r.row}>
                      <td>
                        <input
                          aria-label={tr("Import row {count}").replace(
                            "{count}",
                            num(r.row),
                          )}
                          type="checkbox"
                          disabled={!r.valid || busy}
                          checked={chosen.includes(r.row)}
                          onChange={(e) =>
                            setChosen((rows) =>
                              e.target.checked
                                ? [...rows, r.row]
                                : rows.filter((n) => n !== r.row),
                            )
                          }
                        />
                      </td>
                      <td>{num(r.row)}</td>
                      <td>{r.employeeId}</td>
                      <td>
                        {tr(
                          sections.find((s) => s.slug === r.rowType)?.title ??
                            { PROFILE: "Personal details", SPOUSE: "Spouse" }[
                              r.rowType
                            ] ??
                            "Record",
                        )}
                      </td>
                      <td>
                        {tr(
                          r.action === "CREATE"
                            ? "Add record"
                            : r.action === "UPDATE"
                              ? "Update record"
                              : "Check this row",
                        )}
                      </td>
                      <td>
                        {r.valid ? (
                          tr("Ready")
                        ) : (
                          <>
                            {(r.errors.length
                              ? r.errors
                              : [
                                  "Invalid data entry. Please check this row in your spreadsheet.",
                                ]
                            ).map((message) => (
                              <div key={message} className="field-error">
                                {tr(message)}
                              </div>
                            ))}
                            {r.columns?.length ? (
                              <small>({r.columns.join(", ")})</small>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              disabled={busy || !chosen.length}
              onClick={() => {
                if (
                  !window.confirm(
                    demo
                      ? tr("Import the selected rows?")
                      : tr(
                          "Import the selected rows? New passwords are shown only once.",
                        ),
                  )
                )
                  return;
                void run(async () => {
                  const result = await apiRequest<{
                    count: number;
                    credentials: typeof credentials;
                  }>("/admin/data/files/commit", {
                    method: "POST",
                    body: JSON.stringify({
                      previewId: preview.previewId,
                      selected: chosen,
                    }),
                  });
                  setCredentials(result.credentials);
                  setPreview(null);
                  setChosen([]);
                  setMessage(result.count);
                  await client.invalidateQueries();
                });
              }}
            >
              {tr("Save selected rows (")}
              {num(chosen.length)})
            </button>
          </>
        )}
        {credentials.length > 0 && (
          <div>
            <h3>{tr("Temporary passwords — copy now")}</h3>
            <p>
              {tr(
                "Shown only once. Each employee must set a new password at first sign-in.",
              )}
            </p>
            <pre>
              {credentials
                .map((c) => `${c.employeeId}: ${c.temporaryPassword}`)
                .join("\n")}
            </pre>
            <button onClick={() => setCredentials([])}>
              {tr("Hide passwords")}
            </button>
          </div>
        )}
      </section>
      {fullAdmin && (
        <section className="form-section">
          <h2>{tr("Activity history")}</h2>
          <button
            onClick={() => {
              setShowAudit(true);
              void audit.refetch();
            }}
          >
            {tr("Load recent activity")}
          </button>
          {audit.isError && <p role="alert">{tr(safeError(audit.error))}</p>}
          {showAudit && audit.isPending && (
            <p className="table-message" role="status">
              {tr("Loading activity…")}
            </p>
          )}
          {audit.data?.items.length === 0 && (
            <p className="table-message">{tr("No activity found.")}</p>
          )}
          <ul>
            {audit.data?.items.map((a) => (
              <li key={a.id}>
                {new Date(a.occurredAt).toLocaleString(
                  currentLanguage() === "bn" ? "bn-BD" : "en-GB",
                )}{" "}
                ·{" "}
                {tr(activityLabels[a.action] ?? "Employee information changed")}{" "}
                · {tr(a.actorRole)} {a.reason ?? ""}
              </li>
            ))}
          </ul>
          {showAudit && (
            <div className="form-actions">
              <button
                disabled={auditPage === 1}
                onClick={() => setAuditPage((p) => p - 1)}
              >
                {tr("Previous")}
              </button>
              <span>{num(auditPage)}</span>
              <button
                disabled={(audit.data?.items.length ?? 0) < 50}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                {tr("Next")}
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

const activityLabels: Record<string, string> = {
  EMPLOYEE_RECORD_CREATED: "Employee record created",
  DATA_IMPORTED: "Data added from spreadsheet",
  DEMO_EMPLOYEE_SEEDED: "Sample employee added",
  CHANGE_REQUEST_WITHDRAWN: "Change request withdrawn",
  EMPLOYEE_RECORD_DELETED: "Employee record deleted",
  EMPLOYEE_STATUS_CHANGED: "Employee status changed",
  LEAVE_CORRECTED: "Leave corrected",
  PROFILE_IMAGE_REMOVED: "Profile image removed",
  EMPLOYEE_SPOUSE_UPDATED: "Spouse information updated",
  EMPLOYEE_SELF_EXPORTED: "Employee downloaded their records",
  CHANGE_REQUEST_SUBMITTED: "Change request submitted",
  HOLIDAY_REMOVED: "Holiday removed",
  PROFILE_IMAGE_UPLOADED: "Profile image uploaded",
  EMPLOYEE_CREATED: "Employee created",
  HOLIDAY_CREATED: "Holiday created",
  LEAVE_CREATED: "Leave created",
  EMPLOYEES_EXPORTED: "Employees downloaded",
  EMPLOYEE_RECORD_UPDATED: "Employee record updated",
  EMPLOYEE_SPOUSE_DELETED: "Spouse information deleted",
  PDS_SELF_EXPORTED: "Employee downloaded personal records",
  PDS_ADMIN_EXPORTED: "Administrator downloaded personal records",
  LEAVE_TYPE_UPDATED: "Leave type updated",
  LEAVE_CANCELLED: "Leave cancelled",
  EMPLOYEE_IMPORTED: "Employee added from spreadsheet",
  EMPLOYEE_SPOUSE_CREATED: "Spouse information created",
  EMPLOYEE_UPDATED: "Employee updated",
  LEAVE_TYPE_CREATED: "Leave type created",
  IMPORT_FILE_REJECTED: "Spreadsheet file rejected",
  IMPORT_PREVIEWED: "Spreadsheet previewed",
  DEPARTMENT_UPDATED: "Department updated",
  DEPARTMENT_CREATED: "Department created",
};
