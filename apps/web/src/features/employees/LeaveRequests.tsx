import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tr } from "../../i18n/language";
import { apiRequest } from "../../lib/api";
import { safeError } from "../../lib/public-errors";

type RequestItem = {
  id: string;
  employeeName: string;
  employeeCode: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  remarks: string | null;
  status: string;
  reason: string | null;
};

export default function LeaveRequests({
  admin,
  types,
}: {
  admin: boolean;
  types: { id: string; nameEn: string; isActive: boolean }[];
}) {
  const cache = useQueryClient();
  const path = admin ? "/admin/leave-requests" : "/me/leave-requests";
  const list = useQuery({
    queryKey: ["leave-requests", admin],
    queryFn: () => apiRequest<{ items: RequestItem[] }>(path),
  });
  const [type, setType] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [remarks, setRemarks] = useState("");
  const [rejecting, setRejecting] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: (input: { path: string; body?: object }) =>
      apiRequest(input.path, {
        method: "POST",
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      }),
    onSuccess: async () => {
      setRemarks("");
      setRejecting("");
      setReason("");
      await Promise.all(
        ["leave-requests", "leaves", "day-off-balances", "overview-stats"].map(
          (queryKey) => cache.invalidateQueries({ queryKey: [queryKey] }),
        ),
      );
    },
  });

  return (
    <section className="form-section">
      <div className="form-section-heading">
        <h2>{tr(admin ? "Leave request review" : "My leave requests")}</h2>
      </div>
      {!admin && (
        <form
          className="leave-form"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate({
              path,
              body: {
                leaveTypeId: type,
                startDate: start,
                endDate: end,
                remarks: remarks || null,
              },
            });
          }}
        >
          <label>
            {tr("Leave type")}
            <select
              required
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="">{tr("Choose leave type")}</option>
              {types
                .filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameEn}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {tr("Start date")}
            <input
              required
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </label>
          <label>
            {tr("End date")}
            <input
              required
              type="date"
              min={start}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
          <label>
            {tr("Remarks")}
            <input
              maxLength={2000}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <button disabled={mutation.isPending}>
            {tr("Submit leave request")}
          </button>
        </form>
      )}
      {list.isPending && <p role="status">{tr("Please wait…")}</p>}
      {!list.isPending && list.data?.items.length === 0 && (
        <p className="table-message">{tr("No leave requests found.")}</p>
      )}
      {(list.isError || mutation.isError) && (
        <p role="alert">{tr(safeError(mutation.error ?? list.error))}</p>
      )}
      {mutation.isSuccess && <p role="status">{tr("Saved successfully.")}</p>}
      {list.data?.items.map((item) => (
        <article className="change-request-card" key={item.id}>
          <header className="request-card-header">
            <div>
              <h3>{item.leaveType}</h3>
              {admin && (
                <p>
                  {item.employeeName} ({item.employeeCode})
                </p>
              )}
              <p>
                {item.startDate} – {item.endDate}
              </p>
            </div>
            <span className="request-status" data-status={item.status}>
              {tr(item.status)}
            </span>
          </header>
          {item.remarks && <p>{item.remarks}</p>}
          {item.reason && <p>{item.reason}</p>}
          {item.status === "PENDING" &&
            (admin ? (
              rejecting === item.id ? (
                <form
                  className="leave-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    mutation.mutate({
                      path: path + "/" + item.id + "/decision",
                      body: { action: "REJECT", reason },
                    });
                  }}
                >
                  <label>
                    {tr("Reason")}
                    <input
                      required
                      maxLength={1000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button disabled={mutation.isPending}>{tr("Reject")}</button>
                  <button type="button" onClick={() => setRejecting("")}>
                    {tr("Cancel")}
                  </button>
                </form>
              ) : (
                <div className="form-actions">
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        path: path + "/" + item.id + "/decision",
                        body: { action: "APPROVE" },
                      })
                    }
                  >
                    {tr("Approve")}
                  </button>
                  <button
                    type="button"
                    disabled={mutation.isPending}
                    onClick={() => {
                      setRejecting(item.id);
                      setReason("");
                    }}
                  >
                    {tr("Reject")}
                  </button>
                </div>
              )
            ) : (
              <button
                type="button"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({ path: path + "/" + item.id + "/withdraw" })
                }
              >
                {tr("Withdraw")}
              </button>
            ))}
        </article>
      ))}
    </section>
  );
}
