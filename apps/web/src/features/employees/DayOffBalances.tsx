import "./DayOffBalances.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { num, tr } from "../../i18n/language";

type Balance = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  joiningDate: string | null;
  asOf: string;
  workedDays: number | null;
  earnedDays: number | null;
  takenDays: number | null;
  balanceDays: number | null;
  advanceDays: number | null;
  progressDays: number | null;
  workdaysUntilNext: number | null;
  scheduledDays: number;
};
type Balances = { items: Balance[]; pagination: { hasMore: boolean } };
const display = (value: number | null) => (value === null ? "—" : num(value));

export default function DayOffBalances({ admin }: { admin: boolean }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["day-off-balances", admin, search, page],
    queryFn: async (): Promise<Balances> => {
      if (admin)
        return apiRequest<Balances>(
          `/admin/day-off-balances?q=${encodeURIComponent(search)}&page=${page}`,
        );
      const result = await apiRequest<{ balance: Balance | null }>(
        "/me/day-off-balance",
      );
      return {
        items: result.balance ? [result.balance] : [],
        pagination: { hasMore: false },
      };
    },
    refetchOnWindowFocus: true,
  });
  return (
    <section aria-labelledby="day-off-heading" className="day-off-balances">
      <div className="section-heading day-off-heading">
        <h2 id="day-off-heading">
          {tr(admin ? "Employee day-off balances" : "My day-off balance")}
        </h2>
        {query.data?.items[0] && (
          <span className="day-off-as-of">
            {tr("As of")} {query.data.items[0].asOf}
          </span>
        )}
      </div>
      <p className="page-description">
        {tr(
          "You earn 1 day off for every 11 workdays. Unused days are kept. A minus number means days taken in advance.",
        )}
      </p>
      {admin && (
        <div className="directory-toolbar day-off-toolbar">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={tr("Find employee")}
              value={search}
              maxLength={100}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={tr("Search by name or employee ID")}
            />
          </label>
        </div>
      )}
      {query.isPending && (
        <p className="table-message">{tr("Loading day-off balances…")}</p>
      )}
      {query.isError && (
        <p className="table-message error-text" role="alert">
          {tr("Something went wrong. Please try again.")}
        </p>
      )}
      {query.data && !query.isError && (
        <>
          <div
            className="leave-table-wrap"
            role="region"
            aria-label={tr("Day-off summary")}
            tabIndex={0}
          >
            <table className="leave-table">
              <caption className="day-off-caption">
                {tr("Day-off summary")}
              </caption>
              <thead>
                <tr>
                  {admin && <th scope="col">{tr("Employee")}</th>}
                  {[
                    "Joining date",
                    "Workdays counted",
                    "Earned days",
                    "Taken days",
                    "Remaining days",
                    "Days in advance",
                    "Workdays to next credit",
                    "Scheduled days",
                  ].map((label) => (
                    <th scope="col" key={label}>
                      {tr(label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((row) => (
                  <tr key={row.employeeId}>
                    {admin && (
                      <th scope="row" className="day-off-employee">
                        <Link
                          className="day-off-employee-link"
                          to={`/employees/${row.employeeId}`}
                        >
                          {row.employeeName}
                        </Link>
                        <span className="day-off-employee-code">
                          {row.employeeCode}
                        </span>
                      </th>
                    )}
                    <td>{row.joiningDate ?? tr("Joining date needed")}</td>
                    <td>{display(row.workedDays)}</td>
                    <td>{display(row.earnedDays)}</td>
                    <td>{display(row.takenDays)}</td>
                    <td>
                      <strong
                        className={`day-off-credit${(row.balanceDays ?? 0) < 0 ? " day-off-credit--advance" : ""}`}
                      >
                        {display(row.balanceDays)}
                      </strong>
                    </td>
                    <td>{display(row.advanceDays)}</td>
                    <td>{display(row.workdaysUntilNext)}</td>
                    <td>{row.joiningDate ? num(row.scheduledDays) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!query.data.items.length && (
            <p className="no-employee">{tr("No employees found.")}</p>
          )}
          {query.data.items.some((row) => !row.joiningDate) && (
            <p role="status" className="day-off-notice">
              {tr(
                "The joining date is missing, so the balance cannot be shown. Please contact your administrator.",
              )}
            </p>
          )}
          {admin && (
            <div className="table-pagination day-off-pagination">
              <span>
                {tr("Page")} {num(page)}
              </span>
              <div>
                <button
                  type="button"
                  disabled={page === 1 || query.isFetching}
                  onClick={() => setPage((value) => value - 1)}
                >
                  {tr("Previous")}
                </button>
                <button
                  type="button"
                  disabled={!query.data.pagination.hasMore || query.isFetching}
                  onClick={() => setPage((value) => value + 1)}
                >
                  {tr("Next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
