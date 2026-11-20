import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";

export default function AdminAccessForm({
  employeeId,
  accessLevel,
  departmentId,
}: {
  employeeId: string;
  accessLevel: "FULL" | "DEPARTMENT" | null;
  departmentId: string | null;
}) {
  const [access, setAccess] = useState(accessLevel ?? "NONE");
  const [department, setDepartment] = useState(departmentId ?? "");
  // After a save the employee record reloads with the new access. Follow it here
  // instead of remounting the form, so the success message is not lost.
  const incoming = `${accessLevel ?? "NONE"}|${departmentId ?? ""}`;
  const [synced, setSynced] = useState(incoming);
  if (incoming !== synced) {
    setSynced(incoming);
    setAccess(accessLevel ?? "NONE");
    setDepartment(departmentId ?? "");
  }
  const cache = useQueryClient();
  const departments = useQuery({
    queryKey: ["access-departments"],
    queryFn: () =>
      apiRequest<{ departments: { id: string; nameEn: string }[] }>(
        "/admin/departments",
      ),
  });
  const save = useMutation({
    mutationFn: () =>
      apiRequest(`/admin/employees/${employeeId}/admin-access`, {
        method: "PUT",
        body: JSON.stringify({
          accessLevel: access,
          ...(access === "DEPARTMENT" ? { departmentId: department } : {}),
        }),
      }),
    onSuccess: () => {
      void cache.invalidateQueries();
      window.dispatchEvent(new Event("ems:access-changed"));
    },
  });
  return (
    <section className="form-section access-management admin-access-section">
      <div className="form-section-heading">
        <h2>{tr("Administrator access")}</h2>
        <p>
          {tr(
            "Give this employee admin access. The department they manage can be different from their own department.",
          )}
        </p>
      </div>
      <form
        className="employee-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-grid">
          <label>
            {tr("Access level")}
            <select
              value={access}
              onChange={(event) => {
                setAccess(event.target.value as typeof access);
                save.reset();
              }}
            >
              <option value="NONE">{tr("Employee access only")}</option>
              <option value="FULL">{tr("Full access")}</option>
              <option value="DEPARTMENT">{tr("Department access")}</option>
            </select>
          </label>
          {access === "DEPARTMENT" && (
            <label>
              {tr("Administered department")}
              <select
                required
                value={department}
                onChange={(event) => {
                  setDepartment(event.target.value);
                  save.reset();
                }}
              >
                <option value="">{tr("Select a department")}</option>
                {departments.data?.departments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.nameEn}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="form-note">
          {tr(
            "Full-access admins can do everything, including making new admins. Department admins can manage only the employees in their department, not other admins.",
          )}
        </p>
        {save.isError && (
          <p className="form-error" role="alert">
            {tr(safeError(save.error))}
          </p>
        )}
        {save.isSuccess && (
          <p className="form-success" role="status">
            {tr("Admin access saved. The change applies right away.")}
          </p>
        )}
        <div className="form-actions">
          <button
            className="auth-submit form-submit"
            type="submit"
            disabled={
              save.isPending || (access === "DEPARTMENT" && !department)
            }
          >
            {tr(save.isPending ? "Saving…" : "Save administrator access")}
          </button>
        </div>
      </form>
    </section>
  );
}
