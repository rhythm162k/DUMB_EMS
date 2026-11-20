import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import "./DepartmentsPage.css";

type Department = {
  id: string;
  nameEn: string;
  nameBn: string | null;
  isActive: boolean;
  employeeCount: number;
};
type Employee = {
  id: string;
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string | null;
  designation: string | null;
  employmentStatus: string;
};
type EmployeeResponse = {
  items: Employee[];
  pagination: { page: number; total: number; totalPages: number };
};

export default function DepartmentsPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("department");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const departments = useQuery({
    queryKey: ["department-management"],
    queryFn: () =>
      apiRequest<{ departments: Department[] }>("/admin/departments"),
  });
  const selected = departments.data?.departments.find(
    (department) => department.id === selectedId,
  );
  const employees = useQuery({
    queryKey: ["department-employees", selectedId, search, page],
    enabled: Boolean(selectedId),
    queryFn: () => {
      const params = new URLSearchParams({
        departmentId: selectedId!,
        page: String(page),
        pageSize: "20",
      });
      if (search.trim()) params.set("q", search.trim());
      return apiRequest<EmployeeResponse>(
        `/admin/employees?${params.toString()}`,
      );
    },
    placeholderData: (previous) => previous,
  });
  const choose = (id: string | null) => {
    setParams(id ? { department: id } : {});
    setSearch("");
    setPage(1);
  };

  return (
    <section className="workspace-page">
      <div className="page-heading page-heading-row">
        <div>
          <h1>{tr("Departments")}</h1>
          <p className="page-description">
            {tr("See each department and its employees.")}
          </p>
        </div>
        {selected && (
          <button
            className="dept-back"
            type="button"
            onClick={() => choose(null)}
          >
            {tr("All departments")}
          </button>
        )}
      </div>
      {!selectedId ? (
        departments.isPending ? (
          <p>{tr("Loading departments…")}</p>
        ) : departments.isError ? (
          <p className="error-text" role="alert">
            {tr(safeError(departments.error))}
          </p>
        ) : (
          <div className="dept-grid">
            {departments.data.departments.map((department) => (
              <button
                key={department.id}
                type="button"
                className="dept-card"
                onClick={() => choose(department.id)}
              >
                <span className="dept-card-title">{department.nameEn}</span>
                {department.nameBn && (
                  <span className="dept-card-bn">{department.nameBn}</span>
                )}
                <span className="dept-card-count">
                  <strong>{department.employeeCount}</strong>{" "}
                  {tr(
                    department.employeeCount === 1 ? "employee" : "employees",
                  )}
                </span>
                <span className="dept-card-view">{tr("View employees →")}</span>
              </button>
            ))}
          </div>
        )
      ) : !selected ? (
        <p>
          {tr("Department not found. ")}
          <button type="button" onClick={() => choose(null)}>
            {tr("Back")}
          </button>
        </p>
      ) : (
        <>
          <div className="dept-detail-heading">
            <div>
              <h2>{selected.nameEn}</h2>
              {selected.nameBn && <p>{selected.nameBn}</p>}
              <p>
                {selected.employeeCount}
                {tr(" assigned ")}
                {tr(selected.employeeCount === 1 ? "employee" : "employees")}
              </p>
            </div>
            <label className="dept-search">
              <span className="dept-search-label">
                {tr("Search this department")}
              </span>
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={tr("Name or employee ID")}
              />
            </label>
          </div>
          <div className="table-card">
            {employees.isPending ? (
              <p className="table-message">{tr("Loading employees…")}</p>
            ) : employees.isError ? (
              <p className="table-message error-text" role="alert">
                {tr(safeError(employees.error))}
              </p>
            ) : employees.data.items.length === 0 ? (
              <p className="table-message">
                {tr("No employees found in this department.")}
              </p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{tr("Employee")}</th>
                      <th>{tr("Employee ID")}</th>
                      <th>{tr("Designation")}</th>
                      <th>{tr("Employment")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {employees.data.items.map((employee) => (
                      <tr key={employee.id}>
                        <td>
                          <strong>
                            {employee.firstNameEn} {employee.lastNameEn ?? ""}
                          </strong>
                        </td>
                        <td className="mono-cell">
                          {employee.officialEmployeeId}
                        </td>
                        <td>{employee.designation ?? "—"}</td>
                        <td>
                          {employee.employmentStatus.replaceAll("_", " ")}
                        </td>
                        <td>
                          <Link
                            className="table-action-link"
                            to={`/employees/${employee.id}`}
                            state={{
                              returnTo: `/departments?department=${encodeURIComponent(selectedId!)}`,
                            }}
                          >
                            {tr("View record")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="table-pagination">
              <span>
                {tr("Page ")}
                {employees.data?.pagination.page ?? page}
                {tr(" of ")}
                {employees.data?.pagination.totalPages ?? 1}
              </span>
              <div>
                <button
                  type="button"
                  disabled={page <= 1 || employees.isFetching}
                  onClick={() => setPage((value) => value - 1)}
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
                  onClick={() => setPage((value) => value + 1)}
                >
                  {tr("Next")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
