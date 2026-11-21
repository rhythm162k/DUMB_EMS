import { safeError } from "../../lib/public-errors";
import { currentLanguage, num, tr } from "../../i18n/language";
import { Icons } from "../../app/Icons";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest } from "../../lib/api";

type Department = { id: string; nameEn: string; nameBn: string | null };
type Employee = {
  id: string;
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string | null;
  fullNameBn: string | null;
  designation: string | null;
  employmentStatus: string;
  accountStatus: string;
  department: Department | null;
};
type EmployeeResponse = {
  items: Employee[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
type DepartmentResponse = { departments: Department[] };

export default function EmployeeDirectory({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [page, setPage] = useState(1);
  const departments = useQuery({
    queryKey: ["departments", "active"],
    queryFn: () => apiRequest<DepartmentResponse>("/departments"),
  });
  const employees = useQuery({
    queryKey: ["employees", search, departmentId, employmentStatus, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
      });
      if (search.trim()) params.set("q", search.trim());
      if (departmentId) params.set("departmentId", departmentId);
      if (employmentStatus) params.set("employmentStatus", employmentStatus);
      return apiRequest<EmployeeResponse>(
        `/admin/employees?${params.toString()}`,
      );
    },
    placeholderData: (previous) => previous,
  });

  function updateFilter(update: () => void) {
    update();
    setPage(1);
  }

  const bangla = currentLanguage() === "bn";

  return (
    <section className="workspace-page">
      <div className="page-heading page-heading-row">
        <div>
          <h1>{tr("Employees")}</h1>
        </div>
        <div className="directory-heading-actions">
          <span className="result-count">
            {employees.data ? num(employees.data.pagination.total) : "—"}
            {tr(" employees")}
          </span>
          {!readOnly && (
            <Link className="primary-link-button" to="/employees/new">
              {tr("Add employee")}
            </Link>
          )}
        </div>
      </div>

      <div className="directory-toolbar">
        <label className="search-field">
          {Icons.search}
          <input
            value={search}
            onChange={(event) =>
              updateFilter(() => setSearch(event.target.value))
            }
            placeholder={tr("Search by name or employee ID")}
            aria-label={tr("Search employees")}
          />
        </label>
        <select
          value={departmentId}
          onChange={(event) =>
            updateFilter(() => setDepartmentId(event.target.value))
          }
          aria-label={tr("Filter by department")}
        >
          <option value="">{tr("All departments")}</option>
          {departments.data?.departments.map((department) => (
            <option key={department.id} value={department.id}>
              {(bangla && department.nameBn) || department.nameEn}
            </option>
          ))}
        </select>
        <select
          value={employmentStatus}
          onChange={(event) =>
            updateFilter(() => setEmploymentStatus(event.target.value))
          }
          aria-label={tr("Filter by employment status")}
        >
          <option value="">{tr("All statuses")}</option>
          <option value="ACTIVE">{tr("Active")}</option>
          <option value="TRANSFERRED_OUT">{tr("Transferred out")}</option>
          <option value="SUSPENDED">{tr("Suspended")}</option>
          <option value="RESIGNED">{tr("Resigned")}</option>
          <option value="RETIRED">{tr("Retired")}</option>
          <option value="DECEASED">{tr("Deceased")}</option>
        </select>
      </div>

      <div className="table-card">
        {employees.isPending ? (
          <p className="table-message" role="status">
            {tr("Loading employee records…")}
          </p>
        ) : employees.isError ? (
          <p className="table-message error-text" role="alert">
            {tr(safeError(employees.error))}
          </p>
        ) : employees.data.items.length === 0 ? (
          <p className="table-message">
            {tr("No employees match these filters.")}
          </p>
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label={tr("Employee records")}
            tabIndex={0}
          >
            <table className="data-table data-table--cards">
              <thead>
                <tr>
                  <th>{tr("Employee")}</th>
                  <th>{tr("Employee ID")}</th>
                  <th>{tr("Department")}</th>
                  <th>{tr("Designation")}</th>
                  <th>{tr("Employment")}</th>
                  <th>{tr("Account")}</th>
                </tr>
              </thead>
              <tbody>
                {employees.data.items.map((employee) => {
                  const englishName = [
                    employee.firstNameEn,
                    employee.lastNameEn,
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const name = (bangla && employee.fullNameBn) || englishName;
                  const alternateName =
                    name === englishName ? employee.fullNameBn : englishName;
                  const department =
                    (bangla && employee.department?.nameBn) ||
                    employee.department?.nameEn ||
                    "—";
                  const status = (
                    <span
                      className={`table-status status-${employee.employmentStatus.toLowerCase()}`}
                    >
                      {tr(employee.employmentStatus)}
                    </span>
                  );

                  return (
                    <tr key={employee.id}>
                      <td>
                        <Link
                          className="employee-cell employee-record-link"
                          to={`/employees/${employee.id}`}
                        >
                          <span className="employee-avatar" aria-hidden="true">
                            {employee.firstNameEn.slice(0, 1)}
                            {employee.lastNameEn?.slice(0, 1) ?? ""}
                          </span>
                          <span>
                            <strong>{name}</strong>
                            {alternateName && (
                              <small className="employee-alternate-name">
                                {alternateName}
                              </small>
                            )}
                            <small className="directory-mobile-meta">
                              <span>
                                {employee.officialEmployeeId} · {department}
                              </span>
                              {status}
                            </small>
                          </span>
                        </Link>
                      </td>
                      <td className="mono-cell">
                        {employee.officialEmployeeId}
                      </td>
                      <td>{department}</td>
                      <td>{employee.designation ?? "—"}</td>
                      <td>{status}</td>
                      <td>{tr(employee.accountStatus)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-pagination">
          <span>
            {tr("Page ")}
            {num(employees.data?.pagination.page ?? page)}
            {tr(" of ")}
            {num(employees.data?.pagination.totalPages ?? 1)}
          </span>
          <div>
            <button
              type="button"
              disabled={page <= 1 || employees.isFetching}
              onClick={() => setPage((current) => current - 1)}
            >
              {tr("Previous")}
            </button>
            <button
              type="button"
              disabled={
                !employees.data ||
                page >= employees.data.pagination.totalPages ||
                employees.isFetching
              }
              onClick={() => setPage((current) => current + 1)}
            >
              {tr("Next")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
