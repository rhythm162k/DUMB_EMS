import { safeError } from "../../lib/public-errors";
import { currentLanguage, num, tr } from "../../i18n/language";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import { sections, type Field } from "./pds-fields";

type ChangeRequest = {
  id: string;
  officialEmployeeId?: string;
  employeeName?: string;
  fieldKey: string;
  targetRecordType: string;
  operation: string;
  oldValueSnapshot: unknown;
  proposedValue: unknown;
  status: string;
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewedByName?: string | null;
  reviewedByOfficialId?: string | null;
};
const fields: Field[] = [
  { key: "gender", label: "Gender" },
  { key: "bloodGroup", label: "Blood group" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "joiningDate", label: "Joining date", type: "date" },
  { key: "designation", label: "Designation" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "presentAddress", label: "Present address", type: "textarea" },
  { key: "permanentAddress", label: "Permanent address", type: "textarea" },
  { key: "religion", label: "Religion" },
  { key: "maritalStatus", label: "Marital status" },
];
const spouseFields: Field[] = [
  { key: "spouseName", label: "Spouse name", required: true },
  { key: "spouseOccupation", label: "Occupation" },
  { key: "spouseDateOfBirth", label: "Date of birth", type: "date" },
  { key: "spouseNationalId", label: "National ID" },
];
const labels = Object.fromEntries(
  [...fields, ...spouseFields, ...sections.flatMap((s) => s.fields)].map(
    (f) => [f.key, f.label],
  ),
);
const display = (v: unknown): string =>
  v == null || v === ""
    ? "—"
    : typeof v === "object"
      ? Object.entries(v)
          .map(([k, x]) => `${tr(labels[k] ?? "Detail")}: ${display(x)}`)
          .join(" · ")
      : String(v);
export default function ChangeRequestsPage({
  admin,
  readOnly = false,
}: {
  admin: boolean;
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<"PROFILE" | "SPOUSE" | "PDS">("PROFILE");
  const [section, setSection] = useState("qualifications");
  const [operation, setOperation] = useState("CREATE");
  const [recordId, setRecordId] = useState("");
  const [field, setField] = useState("phone");
  const [values, setValues] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("PENDING");
  const [feedback, setFeedback] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const path = admin
    ? `/admin/change-requests?status=${filter}&page=${page}`
    : `/me/change-requests?page=${page}`;
  const requests = useQuery({
    queryKey: ["change-requests", path],
    queryFn: () => apiRequest<{ items: ChangeRequest[] }>(path),
  });
  const profile = useQuery({
    queryKey: ["my-profile"],
    enabled: !admin && !readOnly,
    queryFn: () =>
      apiRequest<{
        profile: Record<string, unknown>;
        spouse: Record<string, unknown> | null;
        records: Record<string, Record<string, unknown>[]>;
      }>("/me/profile"),
  });
  const departments = useQuery({
    queryKey: ["departments"],
    enabled: !admin && !readOnly,
    queryFn: () =>
      apiRequest<{ departments: { id: string; nameEn: string }[] }>(
        "/departments",
      ),
  });
  const currentSection = sections.find((s) => s.slug === section)!;
  const recordItems = profile.data?.records[currentSection.responseKey] ?? [];
  const addingSpouse = mode === "SPOUSE" && !profile.data?.spouse;
  const allFields =
    mode === "PROFILE"
      ? fields
      : mode === "SPOUSE"
        ? spouseFields
        : currentSection.fields;
  const activeFields =
    (mode === "PDS" && operation === "CREATE") || addingSpouse
      ? allFields
      : allFields.filter((f) => f.key === field);
  const current =
    mode === "PROFILE"
      ? profile.data?.profile
      : mode === "SPOUSE"
        ? profile.data?.spouse
        : recordItems.find((r) => r.id === recordId);
  const mutation = useMutation({
    mutationFn: (a: { path: string; body?: object }) =>
      apiRequest(a.path, {
        method: "POST",
        ...(a.body ? { body: JSON.stringify(a.body) } : {}),
      }),
    onSuccess: async () => {
      setFeedback("Action completed.");
      setValues({});
      setReviewing(null);
      setReason("");
      await Promise.all(
        ["change-requests", "my-profile", "overview-stats"].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onError: (e: Error) => setFeedback(safeError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setFeedback("");
    let body: object;
    const convert = (f: Field) =>
      values[f.key]?.trim()
        ? f.type === "number"
          ? Number(values[f.key])
          : values[f.key]!.trim()
        : null;
    if (mode === "PDS")
      body = {
        targetRecordType: "PDS",
        section,
        operation,
        ...(operation !== "CREATE" ? { targetRecordId: recordId } : {}),
        ...(operation === "UPDATE"
          ? { fieldKey: field, proposedValue: convert(activeFields[0]!) }
          : {}),
        ...(operation === "CREATE"
          ? {
              proposedValue: Object.fromEntries(
                allFields.map((f) => [f.key, convert(f)]),
              ),
            }
          : {}),
      };
    else if (addingSpouse)
      body = {
        targetRecordType: "SPOUSE",
        operation: "CREATE",
        proposedValue: Object.fromEntries(
          spouseFields.map((f) => [f.key, convert(f)]),
        ),
      };
    else
      body = {
        targetRecordType: mode,
        operation: "UPDATE",
        fieldKey: field,
        proposedValue: convert(activeFields[0]!),
      };
    if (
      mode === "PDS" &&
      operation === "DELETE" &&
      !window.confirm(
        tr("Request removal of this record? An administrator must approve it."),
      )
    )
      return;
    mutation.mutate({ path: "/me/change-requests", body });
  }
  const enumValues: Record<string, string[]> = {
    gender: ["MALE", "FEMALE", "OTHER"],
    bloodGroup: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    maritalStatus: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"],
  };
  return (
    <section className="workspace-page change-requests-page">
      <div className="page-heading">
        <h1>{tr(admin ? "Change request review" : "My change requests")}</h1>
        {!admin && (
          <p className="page-description">
            {tr("An administrator must approve changes to your profile.")}
          </p>
        )}
      </div>
      {!admin && !readOnly && (
        <form className="form-section employee-form" onSubmit={submit}>
          <h2>{tr("Submit a request")}</h2>
          {profile.isError && (
            <p role="alert">{tr(safeError(profile.error))}</p>
          )}
          <div className="form-grid">
            <label>
              {tr("Request type")}
              <select
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as typeof mode;
                  setMode(m);
                  setField(
                    m === "PROFILE"
                      ? "phone"
                      : m === "SPOUSE"
                        ? "spouseOccupation"
                        : currentSection.fields[0]!.key,
                  );
                  setValues({});
                  setRecordId("");
                }}
              >
                <option value="PROFILE">{tr("Personal profile field")}</option>
                <option value="SPOUSE">{tr("Spouse information")}</option>
                <option value="PDS">{tr("Service record")}</option>
              </select>
            </label>
            {mode === "PDS" && (
              <>
                <label>
                  {tr("Record section")}
                  <select
                    value={section}
                    onChange={(e) => {
                      setSection(e.target.value);
                      setRecordId("");
                      setValues({});
                      setField(
                        sections.find((s) => s.slug === e.target.value)!
                          .fields[0]!.key,
                      );
                    }}
                  >
                    {sections.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {tr(s.title)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {tr("Operation")}
                  <select
                    value={operation}
                    onChange={(e) => {
                      setOperation(e.target.value);
                      setValues({});
                    }}
                  >
                    <option value="CREATE">{tr("Add record")}</option>
                    <option value="UPDATE">{tr("Update one field")}</option>
                    <option value="DELETE">{tr("Delete record")}</option>
                  </select>
                </label>
                {operation !== "CREATE" && (
                  <label>
                    {tr("Existing record")}
                    <select
                      required
                      value={recordId}
                      onChange={(e) => {
                        setRecordId(e.target.value);
                        setValues({});
                      }}
                    >
                      <option value="">{tr("Select a record")}</option>
                      {recordItems.map((r) => (
                        <option key={String(r.id)} value={String(r.id)}>
                          {currentSection.fields
                            .slice(0, 3)
                            .map((f) => display(r[f.key]))
                            .join(" · ")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {!addingSpouse && (mode !== "PDS" || operation === "UPDATE") && (
              <label>
                {tr("Field")}
                <select
                  value={field}
                  onChange={(e) => {
                    setField(e.target.value);
                    setValues({});
                  }}
                >
                  {allFields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {tr(f.label)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(mode !== "PDS" || operation !== "DELETE") &&
              activeFields.map((f) => (
                <label
                  key={f.key}
                  className={f.type === "textarea" ? "form-field-wide" : ""}
                >
                  {tr(f.label)}
                  {(mode === "PROFILE" ||
                    (mode === "SPOUSE" && !addingSpouse) ||
                    operation === "UPDATE") && (
                    <small className="field-help">
                      {tr("Current: ")}
                      {display(current?.[f.key])}
                    </small>
                  )}
                  {enumValues[f.key] ? (
                    <select
                      required={f.key !== "maritalStatus"}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">{tr("Select value")}</option>
                      {enumValues[f.key]!.map((v) => (
                        <option key={v} value={v}>
                          {tr(v)}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "department" ? (
                    <select
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">{tr("No department")}</option>
                      {departments.data?.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nameEn}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      maxLength={1000}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <input
                      type={
                        f.type === "number"
                          ? "number"
                          : f.type === "date"
                            ? "date"
                            : f.key === "email"
                              ? "email"
                              : f.type === "url"
                                ? "url"
                                : "text"
                      }
                      required={f.required}
                      min={f.type === "number" ? 1900 : undefined}
                      max={
                        f.type === "number"
                          ? new Date().getFullYear() + 1
                          : undefined
                      }
                      maxLength={300}
                      value={values[f.key] ?? ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    />
                  )}
                </label>
              ))}
          </div>
          <p className="field-help">
            {tr(
              "Each request can change one item only. To remove a detail, leave it blank.",
            )}
          </p>
          <button
            className="auth-submit form-submit"
            disabled={mutation.isPending || !profile.data}
          >
            {tr("Submit for review")}
          </button>
        </form>
      )}
      {feedback && (
        <p role="status" className="form-note">
          {tr(feedback)}
        </p>
      )}
      <section className="form-section">
        <header className="request-queue-header">
          <h2>{tr(admin ? "Review queue" : "Request history")}</h2>
          {admin && (
            <label>
              {tr("Show requests")}
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setPage(1);
                  setReviewing(null);
                }}
              >
                {["PENDING", "ALL", "APPROVED", "REJECTED", "WITHDRAWN"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {tr(status)}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
        </header>
        {requests.isPending ? (
          <p className="table-message" role="status">
            {tr("Loading requests…")}
          </p>
        ) : requests.isError ? (
          <p role="alert">{tr(safeError(requests.error))}</p>
        ) : requests.data.items.length === 0 ? (
          <p className="table-message">{tr("No requests found.")}</p>
        ) : (
          requests.data.items.map((item) => {
            const section = sections.find(
              (record) => `PDS:${record.slug}` === item.targetRecordType,
            );
            const recordLabel =
              section?.title ??
              (item.targetRecordType === "PROFILE"
                ? "Personal details"
                : item.targetRecordType === "SPOUSE"
                  ? "Spouse"
                  : "Service record");
            const field = labels[item.fieldKey];
            const employee = [item.employeeName, item.officialEmployeeId]
              .filter(Boolean)
              .join(" · ");
            const locale = currentLanguage() === "bn" ? "bn-BD" : "en-GB";
            const pending = item.status === "PENDING";
            return (
              <article className="change-request-card" key={item.id}>
                <header className="request-card-header">
                  <div>
                    {admin && <p className="request-employee">{employee}</p>}
                    <h3>
                      {field
                        ? `${tr(recordLabel)} / ${tr(field)}`
                        : tr(recordLabel)}
                    </h3>
                    <p>
                      {tr(item.operation)} ·{" "}
                      {new Date(item.submittedAt).toLocaleDateString(locale)}
                    </p>
                  </div>
                  <span className="request-status" data-status={item.status}>
                    {tr(item.status)}
                  </span>
                </header>
                <dl className="request-comparison">
                  <div>
                    <dt>{tr("Current at submission")}</dt>
                    <dd>{display(item.oldValueSnapshot)}</dd>
                  </div>
                  <div>
                    <dt>{tr("Proposed")}</dt>
                    <dd>{display(item.proposedValue)}</dd>
                  </div>
                </dl>
                {admin &&
                  item.reviewedAt &&
                  (item.status === "APPROVED" ||
                    item.status === "REJECTED") && (
                    <p>
                      {tr(
                        item.status === "APPROVED"
                          ? "Approved by "
                          : "Rejected by ",
                      )}
                      {item.reviewedByName ?? tr("Administrator")}
                      {item.reviewedByOfficialId &&
                        ` (${item.reviewedByOfficialId})`}
                      {" · "}
                      {new Date(item.reviewedAt).toLocaleString(locale)}
                    </p>
                  )}
                {item.rejectionReason && (
                  <p className="form-error">
                    {tr("Reason: ")}
                    {item.rejectionReason}
                  </p>
                )}
                {pending && !readOnly && (
                  <div className="form-actions">
                    {admin ? (
                      <>
                        <button
                          type="button"
                          className="primary-link-button"
                          disabled={mutation.isPending || reviewing === item.id}
                          onClick={() =>
                            mutation.mutate({
                              path: `/admin/change-requests/${item.id}/decision`,
                              body: { action: "APPROVE" },
                            })
                          }
                        >
                          {tr("Approve")}
                        </button>
                        <button
                          id={`reject-request-${item.id}`}
                          type="button"
                          aria-expanded={reviewing === item.id}
                          disabled={mutation.isPending}
                          onClick={() => {
                            setReviewing(
                              reviewing === item.id ? null : item.id,
                            );
                            setReason("");
                          }}
                        >
                          {tr("Reject")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            path: `/me/change-requests/${item.id}/withdraw`,
                          })
                        }
                      >
                        {tr("Withdraw")}
                      </button>
                    )}
                  </div>
                )}
                {admin && pending && reviewing === item.id && (
                  <form
                    className="request-rejection"
                    onSubmit={(event) => {
                      event.preventDefault();
                      mutation.mutate({
                        path: `/admin/change-requests/${item.id}/decision`,
                        body: { action: "REJECT", reason },
                      });
                    }}
                  >
                    <label>
                      {tr("Rejection reason")}
                      <textarea
                        required
                        maxLength={1000}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button disabled={mutation.isPending}>
                        {tr("Confirm rejection")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          document
                            .getElementById(`reject-request-${item.id}`)
                            ?.focus();
                          setReviewing(null);
                        }}
                      >
                        {tr("Cancel")}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })
        )}
      </section>
      <div className="form-actions">
        <button
          disabled={page === 1}
          onClick={() => {
            setReviewing(null);
            setPage((p) => p - 1);
          }}
        >
          {tr("Previous")}
        </button>
        <span>{num(page)}</span>
        <button
          disabled={(requests.data?.items.length ?? 0) < 50}
          onClick={() => {
            setReviewing(null);
            setPage((p) => p + 1);
          }}
        >
          {tr("Next")}
        </button>
      </div>
    </section>
  );
}
