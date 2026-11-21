import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";

type Department = {
  id: string;
  nameEn: string;
  nameBn: string | null;
  isActive: boolean;
  version?: number;
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

function DepartmentForm({ department }: { department?: Department }) {
  const cache = useQueryClient();
  const [nameEn, setNameEn] = useState(department?.nameEn ?? "");
  const [nameBn, setNameBn] = useState(department?.nameBn ?? "");
  const [isActive, setActive] = useState(department?.isActive ?? true);
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(
        department
          ? `/admin/departments/${department.id}`
          : "/admin/departments",
        {
          method: department ? "PATCH" : "POST",
          headers: department?.version
            ? { "If-Match": String(department.version) }
            : undefined,
          body: JSON.stringify({
            nameEn,
            nameBn: nameBn || null,
            ...(department ? { isActive } : {}),
          }),
        },
      ),
    onSuccess: async () => {
      if (!department) {
        setNameEn("");
        setNameBn("");
      }
      await cache.invalidateQueries();
    },
  });
  return (
    <details className="form-section">
      <summary>{tr(department ? "Edit department" : "Add department")}</summary>
      <form
        className="employee-form"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          <label>
            {tr("English name")}
            <input
              required
              maxLength={150}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </label>
          <label>
            {tr("Bangla name")}
            <input
              maxLength={150}
              value={nameBn}
              onChange={(e) => setNameBn(e.target.value)}
            />
          </label>
          {department && (
            <label>
              {tr("Department status")}
              <select
                value={String(isActive)}
                onChange={(e) => setActive(e.target.value === "true")}
              >
                <option value="true">{tr("Active")}</option>
                <option value="false">{tr("Inactive")}</option>
              </select>
            </label>
          )}
        </div>
        <button className="auth-submit" disabled={mutation.isPending}>
          {tr(department ? "Save department" : "Add department")}
        </button>
        {mutation.isError && (
          <p role="alert">{tr(safeError(mutation.error))}</p>
        )}
        {mutation.isSuccess && <p role="status">{tr("Saved successfully.")}</p>}
      </form>
    </details>
  );
}
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
      {import.meta.env.MODE === "worker" && (!selectedId || selected) && (
        <DepartmentForm key={selected?.id ?? "new"} department={selected} />
      )}
      {!selectedId ? (
        departments.isPending ? (
          <p className="table-message" role="status">
            {tr("Loading departments…")}
          </p>
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
              <p className="table-message" role="status">
                {tr("Loading employees…")}
              </p>
            ) : employees.isError ? (
              <p className="table-message error-text" role="alert">
                {tr(safeError(employees.error))}
              </p>
            ) : employees.data.items.length === 0 ? (
              <p className="table-message">
                {tr("No employees found in this department.")}
              </p>
            ) : (
              <div
                className="table-scroll"
                role="region"
                aria-label={tr("Department employees")}
                tabIndex={0}
              >
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
