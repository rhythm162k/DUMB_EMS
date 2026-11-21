import { safeError } from "../../lib/public-errors";
import LeaveRequests from "./LeaveRequests";
import DayOffBalances from "./DayOffBalances";
import { tr } from "../../i18n/language";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";

type Leave = {
  id: string;
  version?: number;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  remarks: string | null;
  cancelledAt: string | null;
  lastCorrectionReason: string | null;
};
type LeaveType = {
  id: string;
  code: string;
  nameEn: string;
  isActive: boolean;
};
type Holiday = {
  id: string;
  holidayDate: string;
  nameEn: string;
  sourceNote: string | null;
};
type Employee = {
  id: string;
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string;
};
const today = new Date().toISOString().slice(0, 10);
function dateOnly(value: string) {
  return value.slice(0, 10);
}
export default function LeavePage({
  admin,
  fullAdmin = false,
  readOnly = false,
}: {
  admin: boolean;
  fullAdmin?: boolean;
  readOnly?: boolean;
}) {
  const canEdit = admin && !readOnly;
  const canConfigure = fullAdmin && canEdit;
  const queryClient = useQueryClient();
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [remarks, setRemarks] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState<number>();
  const [reason, setReason] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidayDate, setHolidayDate] = useState(today);
  const [holidayName, setHolidayName] = useState("");
  const [holidaySource, setHolidaySource] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [typeName, setTypeName] = useState("");
  const [message, setMessage] = useState("");
  const leaves = useQuery({
    queryKey: ["leaves", admin],
    queryFn: () =>
      apiRequest<{ items: Leave[] }>(admin ? "/admin/leaves" : "/me/leaves"),
  });
  const types = useQuery({
    queryKey: ["leave-types"],
    enabled: !readOnly,
    queryFn: () => apiRequest<{ items: LeaveType[] }>("/leave-types"),
  });
  const holidays = useQuery({
    queryKey: ["holidays", year],
    queryFn: () => apiRequest<{ items: Holiday[] }>(`/holidays?year=${year}`),
  });
  const employees = useQuery({
    queryKey: ["leave-employees", employeeSearch, employeePage],
    enabled: canEdit,
    queryFn: () =>
      apiRequest<{ items: Employee[] }>(
        `/admin/employees?pageSize=100&page=${employeePage}&q=${encodeURIComponent(employeeSearch)}`,
      ),
  });
  const mutation = useMutation({
    mutationFn: async ({
      path,
      method,
      body,
      version,
    }: {
      path: string;
      method: string;
      body?: unknown;
      version?: number;
    }) =>
      apiRequest(path, {
        method,
        headers: version ? { "If-Match": String(version) } : undefined,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    onSuccess: async () => {
      setMessage("Saved successfully.");
      setEditing(null);
      setEditingVersion(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["leaves"] }),
        queryClient.invalidateQueries({ queryKey: ["day-off-balances"] }),
        queryClient.invalidateQueries({ queryKey: ["leave-types"] }),
        queryClient.invalidateQueries({ queryKey: ["holidays"] }),
        queryClient.invalidateQueries({ queryKey: ["overview-stats"] }),
      ]);
    },
    onError: (error) => setMessage(safeError(error)),
  });
  const send = (
    path: string,
    method: string,
    body?: unknown,
    version?: number,
  ) => {
    setMessage("");
    mutation.mutate({ path, method, body, version });
  };
  function submitLeave(event: FormEvent) {
    event.preventDefault();
    if (!editing && !employeeId) {
      setMessage("Choose an employee.");
      return;
    }
    if (editing && !reason.trim()) {
      setMessage("A correction reason is required.");
      return;
    }
    send(
      editing ? `/admin/leaves/${editing}` : "/admin/leaves",
      editing ? "PATCH" : "POST",
      {
        ...(!editing ? { employeeId } : {}),
        leaveTypeId,
        startDate,
        endDate,
        remarks: remarks || null,
        ...(editing ? { reason } : {}),
      },
      editing ? editingVersion : undefined,
    );
  }
  function edit(row: Leave) {
    setEditing(row.id);
    setEditingVersion(row.version);
    setEmployeeId(row.employeeId);
    setLeaveTypeId(row.leaveTypeId);
    setStartDate(dateOnly(row.startDate));
    setEndDate(dateOnly(row.endDate));
    setRemarks(row.remarks ?? "");
    setReason("");
  }
  return (
    <section className="workspace-page leave-page">
      <div className="page-heading">
        <h1>{tr("Leave history")}</h1>
        <p className="page-description">
          {tr(
            readOnly
              ? "View leave history."
              : "View day-off balances and leave history.",
          )}
        </p>
      </div>
      {message && <p role="status">{tr(message)}</p>}
      {!readOnly && <DayOffBalances admin={admin} />}
      {import.meta.env.MODE === "worker" && (
        <LeaveRequests admin={admin} types={types.data?.items ?? []} />
      )}
      {canEdit && (
        <>
          <div className="section-heading">
            <h2>{tr(editing ? "Correct leave record" : "Record leave")}</h2>
          </div>
          <form className="leave-form" onSubmit={submitLeave}>
            {!editing && (
              <label>
                {tr("Find employee")}
                <input
                  value={employeeSearch}
                  onChange={(e) => {
                    setEmployeeSearch(e.target.value);
                    setEmployeePage(1);
                  }}
                  placeholder={tr("Search by name or employee ID")}
                />
              </label>
            )}
            {!editing && (
              <div className="form-actions">
                <button
                  type="button"
                  disabled={employeePage === 1}
                  onClick={() => setEmployeePage((p) => p - 1)}
                >
                  {tr("Previous employees")}
                </button>
                <button
                  type="button"
                  disabled={(employees.data?.items.length ?? 0) < 100}
                  onClick={() => setEmployeePage((p) => p + 1)}
                >
                  {tr("Next employees")}
                </button>
              </div>
            )}
            {!editing && (
              <label>
                {tr("Employee ")}
                <select
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                >
                  <option value="">{tr("Select employee")}</option>
                  {(employees.data?.items ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.officialEmployeeId} — {e.firstNameEn} {e.lastNameEn}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {tr("Leave type ")}
              <select
                required
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
              >
                <option value="">{tr("Select type")}</option>
                {(types.data?.items ?? [])
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nameEn}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {tr("Start date ")}
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label>
              {tr("End date ")}
              <input
                type="date"
                required
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label>
              {tr("Remarks ")}
              <input
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                maxLength={2000}
              />
            </label>
            {editing && (
              <label>
                {tr("Correction reason ")}
                <input
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={1000}
                />
              </label>
            )}
            <button type="submit" disabled={mutation.isPending}>
              {tr(editing ? "Save correction" : "Record leave")}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setReason("");
                }}
              >
                {tr("Cancel editing")}
              </button>
            )}
          </form>
        </>
      )}
      <div className="section-heading">
        <h2>{tr(admin ? "All recorded leave" : "My leave history")}</h2>
      </div>
      {leaves.isLoading && (
        <p className="table-message" role="status">
          {tr("Loading leave records…")}
        </p>
      )}
      {leaves.isError && (
        <p role="alert">{tr("Something went wrong. Please try again.")}</p>
      )}
      {!!leaves.data?.items.length && (
        <div
          className="leave-table-wrap"
          role="region"
          aria-label={tr("Leave history")}
          tabIndex={0}
        >
          <table className="leave-table">
            <thead>
              <tr>
                {admin && <th>{tr("Employee")}</th>}
                <th>{tr("Type")}</th>
                <th>{tr("Dates")}</th>
                <th>{tr("Days")}</th>
                <th>{tr("Status")}</th>
                {canEdit && <th>{tr("Actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {(leaves.data?.items ?? []).map((row) => (
                <tr key={row.id}>
                  {admin && (
                    <td>
                      {row.employeeName} ({row.employeeCode})
                    </td>
                  )}
                  <td>{row.leaveType}</td>
                  <td>
                    {dateOnly(row.startDate)} – {dateOnly(row.endDate)}
                  </td>
                  <td>{row.dayCount}</td>
                  <td>{tr(row.cancelledAt ? "Cancelled" : "Recorded")}</td>
                  {canEdit && (
                    <td>
                      {!row.cancelledAt && (
                        <>
                          <button type="button" onClick={() => edit(row)}>
                            {tr("Correct")}
                          </button>{" "}
                          <button
                            type="button"
                            disabled={mutation.isPending}
                            onClick={() => {
                              const reason = window.prompt(
                                tr("Reason for cancellation (required):"),
                              );
                              if (reason?.trim())
                                send(
                                  `/admin/leaves/${row.id}/cancel`,
                                  "POST",
                                  {
                                    reason: reason.trim(),
                                  },
                                  row.version,
                                );
                            }}
                          >
                            {tr("Cancel")}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {leaves.data?.items.length === 0 && (
        <p className="table-message">{tr("No leave records found.")}</p>
      )}
      {canConfigure && (
        <>
          <div className="section-heading">
            <h2>{tr("Leave types")}</h2>
          </div>
          <form
            className="leave-form"
            onSubmit={(e) => {
              e.preventDefault();
              send("/admin/leave-types", "POST", {
                code: typeCode.trim().toUpperCase(),
                nameEn: typeName,
              });
            }}
          >
            <label>
              {tr("Code ")}
              <input
                required
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value)}
                placeholder="SPECIAL"
              />
            </label>
            <label>
              {tr("Name ")}
              <input
                required
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
              />
            </label>
            <button disabled={mutation.isPending}>{tr("Add type")}</button>
          </form>
          <div className="leave-items">
            {types.data?.items.map((t) => (
              <div key={t.id}>
                {t.nameEn} ({t.code}) — {tr(t.isActive ? "Active" : "Inactive")}{" "}
                <button
                  disabled={mutation.isPending}
                  onClick={() =>
                    send(`/admin/leave-types/${t.id}`, "PATCH", {
                      isActive: !t.isActive,
                    })
                  }
                >
                  {tr(t.isActive ? "Deactivate" : "Activate")}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="section-heading">
        <h2>{tr("Configured public holidays")}</h2>
      </div>
      <p className="page-description">
        {tr(
          "Fridays, Saturdays and listed public holidays are not counted as workdays or leave days.",
        )}
      </p>
      <label>
        {tr("Year ")}
        <input
          type="number"
          min={2000}
          max={2100}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </label>
      {canConfigure && (
        <form
          className="leave-form"
          onSubmit={(e) => {
            e.preventDefault();
            send("/admin/holidays", "POST", {
              holidayDate,
              nameEn: holidayName,
              sourceNote: holidaySource || null,
            });
          }}
        >
          <label>
            {tr("Date ")}
            <input
              type="date"
              required
              value={holidayDate}
              onChange={(e) => setHolidayDate(e.target.value)}
            />
          </label>
          <label>
            {tr("Holiday name ")}
            <input
              required
              value={holidayName}
              onChange={(e) => setHolidayName(e.target.value)}
            />
          </label>
          <label>
            {tr("Source note ")}
            <input
              value={holidaySource}
              onChange={(e) => setHolidaySource(e.target.value)}
            />
          </label>
          <button disabled={mutation.isPending}>{tr("Add holiday")}</button>
        </form>
      )}
      {holidays.isError && (
        <p role="alert">{tr("Something went wrong. Please try again.")}</p>
      )}
      <div className="leave-items">
        {holidays.data?.items.map((h) => (
          <div key={h.id}>
            {dateOnly(h.holidayDate)} — {h.nameEn}
            {canConfigure && (
              <button
                disabled={mutation.isPending}
                onClick={() => {
                  if (window.confirm(tr("Remove this holiday?")))
                    send(`/admin/holidays/${h.id}`, "DELETE");
                }}
              >
                {tr("Remove")}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
