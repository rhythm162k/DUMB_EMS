import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../../lib/api";

type Department = { id: string; nameEn: string; nameBn: string | null };
type DepartmentsResponse = { departments: Department[] };
type CreatedResponse = {
  employee: { id: string; officialEmployeeId: string } | null;
  temporaryPassword: string;
  message: string;
};
type FormValues = {
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string;
  fullNameBn: string;
  departmentId: string;
  gender: string;
  bloodGroup: string;
  dateOfBirth: string;
  designation: string;
  joiningDate: string;
  nationalId: string;
  phone: string;
  email: string;
  fatherName: string;
  motherName: string;
  religion: string;
  maritalStatus: string;
};
const initialValues: FormValues = {
  officialEmployeeId: "",
  firstNameEn: "",
  lastNameEn: "",
  fullNameBn: "",
  departmentId: "",
  gender: "",
  bloodGroup: "",
  dateOfBirth: "",
  designation: "",
  joiningDate: "",
  nationalId: "",
  phone: "",
  email: "",
  fatherName: "",
  motherName: "",
  religion: "",
  maritalStatus: "",
};
const nullableFields = [
  "lastNameEn",
  "fullNameBn",
  "dateOfBirth",
  "designation",
  "joiningDate",
  "nationalId",
  "phone",
  "email",
  "fatherName",
  "motherName",
  "religion",
  "maritalStatus",
] as const;

export default function EmployeeCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(initialValues);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const departments = useQuery({
    queryKey: ["departments", "active"],
    queryFn: () => apiRequest<DepartmentsResponse>("/departments"),
  });
  const createEmployee = useMutation({
    gcTime: 0,
    mutationFn: () => {
      const payload: Record<string, string | null> = { ...values };
      for (const field of nullableFields)
        payload[field] = values[field] || null;
      return apiRequest<CreatedResponse>("/admin/employees", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (result) => {
      setTemporaryPassword(result.temporaryPassword);
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  async function copyPassword() {
    await navigator.clipboard.writeText(temporaryPassword);
    setCopied(true);
  }

  if (temporaryPassword)
    return (
      <section className="workspace-page">
        <div className="page-heading">
          <p className="eyebrow">{tr("EMPLOYEE CREATED")}</p>
          <h1>{tr("Sign-in details")}</h1>
          <p className="page-description">
            {tr(
              "Copy this temporary password and give it to the employee. It will not be shown again after you leave this page.",
            )}
          </p>
        </div>
        <div className="credential-card">
          <p>
            <strong>{tr("Official employee ID")}</strong>
            <span>
              {createEmployee.data?.employee?.officialEmployeeId ??
                values.officialEmployeeId}
            </span>
          </p>
          <p>
            <strong>{tr("Temporary password")}</strong>
            <code>{temporaryPassword}</code>
          </p>
          <div className="form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void copyPassword()}
            >
              {tr(copied ? "Copied" : "Copy password")}
            </button>
            <Link
              className="primary-link-button"
              to={
                createEmployee.data?.employee?.id
                  ? `/employees/${createEmployee.data.employee.id}`
                  : "/employees"
              }
            >
              {tr("Open employee profile")}
            </Link>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate("/employees")}
            >
              {tr("Back to employees")}
            </button>
          </div>
        </div>
      </section>
    );

  return (
    <section className="workspace-page">
      <div className="page-heading page-heading-row">
        <div>
          <h1>{tr("Add employee")}</h1>
          <p className="page-description">
            {tr(
              "Add a new employee and their sign-in account. The employee ID cannot be changed later.",
            )}
          </p>
        </div>
        <Link className="secondary-link-button" to="/employees">
          {tr("Back to directory")}
        </Link>
      </div>
      <form
        className="employee-form"
        onSubmit={(event) => {
          event.preventDefault();
          createEmployee.mutate();
        }}
      >
        <div className="form-section">
          <div className="form-section-heading">
            <h2>{tr("Employment information")}</h2>
            <p>{tr("Required fields are marked with an asterisk.")}</p>
          </div>
          <div className="form-grid">
            <label>
              {tr("Official employee ID *")}
              <input
                required
                maxLength={50}
                value={values.officialEmployeeId}
                onChange={(e) => set("officialEmployeeId", e.target.value)}
              />
            </label>
            <label>
              {tr("Department *")}
              <select
                required
                value={values.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}
              >
                <option value="">{tr("Select department")}</option>
                {departments.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameEn}
                    {d.nameBn ? ` · ${d.nameBn}` : ""}
                  </option>
                ))}
              </select>
              {departments.isError && (
                <small className="field-error">
                  {tr(safeError(departments.error))}
                </small>
              )}
            </label>
            <label>
              {tr("Designation")}
              <input
                maxLength={150}
                value={values.designation}
                onChange={(e) => set("designation", e.target.value)}
              />
            </label>
            <label>
              {tr("Joining date")}
              <input
                type="date"
                value={values.joiningDate}
                onChange={(e) => set("joiningDate", e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-heading">
            <h2>{tr("Personal information")}</h2>
          </div>
          <div className="form-grid">
            <label>
              {tr("First name (English) *")}
              <input
                required
                maxLength={100}
                value={values.firstNameEn}
                onChange={(e) => set("firstNameEn", e.target.value)}
              />
            </label>
            <label>
              {tr("Last name (English)")}
              <input
                maxLength={100}
                value={values.lastNameEn}
                onChange={(e) => set("lastNameEn", e.target.value)}
              />
            </label>
            <label>
              {tr("Full name (বাংলা)")}
              <input
                maxLength={200}
                value={values.fullNameBn}
                onChange={(e) => set("fullNameBn", e.target.value)}
              />
            </label>
            <label>
              {tr("Date of birth")}
              <input
                type="date"
                value={values.dateOfBirth}
                onChange={(e) => set("dateOfBirth", e.target.value)}
              />
            </label>
            <label>
              {tr("Gender *")}
              <select
                required
                value={values.gender}
                onChange={(e) => set("gender", e.target.value)}
              >
                <option value="">{tr("Select gender")}</option>
                <option value="MALE">{tr("Male")}</option>
                <option value="FEMALE">{tr("Female")}</option>
                <option value="OTHER">{tr("Other")}</option>
              </select>
            </label>
            <label>
              {tr("Blood group *")}
              <select
                required
                value={values.bloodGroup}
                onChange={(e) => set("bloodGroup", e.target.value)}
              >
                <option value="">{tr("Select blood group")}</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
                  (group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {tr("National ID")}
              <input
                maxLength={30}
                value={values.nationalId}
                onChange={(e) => set("nationalId", e.target.value)}
              />
            </label>
            <label>
              {tr("Phone")}
              <input
                type="tel"
                maxLength={30}
                value={values.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </label>
            <label>
              {tr("Email")}
              <input
                type="email"
                maxLength={254}
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </label>
            <label>
              {tr("Father's name")}
              <input
                maxLength={200}
                value={values.fatherName}
                onChange={(e) => set("fatherName", e.target.value)}
              />
            </label>
            <label>
              {tr("Mother's name")}
              <input
                maxLength={200}
                value={values.motherName}
                onChange={(e) => set("motherName", e.target.value)}
              />
            </label>
            <label>
              {tr("Religion")}
              <input
                maxLength={50}
                value={values.religion}
                onChange={(e) => set("religion", e.target.value)}
              />
            </label>
            <label>
              {tr("Marital status")}
              <select
                value={values.maritalStatus}
                onChange={(e) => set("maritalStatus", e.target.value)}
              >
                <option value="">{tr("Not specified")}</option>
                <option value="SINGLE">{tr("Single")}</option>
                <option value="MARRIED">{tr("Married")}</option>
                <option value="DIVORCED">{tr("Divorced")}</option>
                <option value="WIDOWED">{tr("Widowed")}</option>
              </select>
            </label>
          </div>
        </div>
        {createEmployee.isError && (
          <p className="form-error" role="alert">
            {tr(safeError(createEmployee.error))}
          </p>
        )}
        <div className="form-actions">
          <button
            className="auth-submit form-submit"
            type="submit"
            disabled={
              createEmployee.isPending ||
              departments.isPending ||
              !departments.data?.departments.length
            }
          >
            {tr(
              createEmployee.isPending
                ? "Creating employee…"
                : "Create employee",
            )}
          </button>
          <Link className="secondary-link-button" to="/employees">
            {tr("Cancel")}
          </Link>
        </div>
        <p className="form-note">
          {tr(
            "A temporary password is made automatically. The employee must change it at first sign-in.",
          )}
        </p>
      </form>
    </section>
  );
}
