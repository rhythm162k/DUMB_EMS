import AdminAccessForm from "./AdminAccessForm";
import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import ProfileImageEditor from "./ProfileImageEditor";
import { isReadOnlyRootRecord } from "./record-access";
import EmployeePdsPanel from "./EmployeePdsPanel";
import ProfilePhoto from "./ProfilePhoto";
import ReadOnlyRecordSections from "./ReadOnlyRecordSections";
import RecordSectionLinks from "./RecordSectionLinks";

type Department = { id: string; nameEn: string; nameBn: string | null };
type Employee = {
  id: string;
  profileImageUrl: string | null;
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string | null;
  fullNameBn: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  bloodGroup: string | null;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  designation: string | null;
  joiningDate: string | null;
  fatherName: string | null;
  motherName: string | null;
  religion: string | null;
  maritalStatus: string | null;
  employmentStatus: string;
  department: Department | null;
  account: {
    role: string;
    adminScope: "FULL" | "DEPARTMENT" | null;
    isRoot?: boolean;
    administeredDepartmentId: string | null;
    accountStatus: string;
    mustChangePassword: boolean;
    lastLoginAt: string | null;
  } | null;
};
type Spouse = {
  id: string;
  spouseName: string;
  spouseOccupation: string | null;
  spouseDateOfBirth: string | null;
  spouseNationalId: string | null;
};
type PdsRecord = { id: string; [key: string]: string | number | null };
type DetailResponse = {
  employee: Employee;
  records: Record<string, PdsRecord[]>;
  spouse: Spouse | null;
};
type StatusUpdate = {
  employmentStatus: string;
  accountStatus?: string;
  reason?: string;
};
type PasswordResetResponse = {
  temporaryPassword: string;
  message: string;
  mustChangePassword: true;
};
type DepartmentsResponse = { departments: Department[] };
type Editable = {
  firstNameEn: string;
  lastNameEn: string;
  fullNameBn: string;
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  nationalId: string;
  phone: string;
  email: string;
  presentAddress: string;
  permanentAddress: string;
  designation: string;
  joiningDate: string;
  fatherName: string;
  motherName: string;
  religion: string;
  maritalStatus: string;
  departmentId: string;
};
const empty = (value: string | null) => value ?? "";

export default function EmployeeDetailPage({
  ownProfile = false,
  fullAdmin = false,
  rootAdmin = false,
  employeeRecordId,
}: {
  ownProfile?: boolean;
  fullAdmin?: boolean;
  rootAdmin?: boolean;
  employeeRecordId?: string | null;
}) {
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const backTarget = ownProfile
    ? "/"
    : returnTo?.startsWith("/departments?department=")
      ? returnTo
      : "/employees";
  const backLabel = ownProfile
    ? "Overview"
    : backTarget === "/employees"
      ? "Back to directory"
      : "Back to department";
  const { employeeId: routeEmployeeId = "" } = useParams();
  const employeeId = ownProfile ? (employeeRecordId ?? "") : routeEmployeeId;
  // The signed-in administrator's own employee record (also passed on the directory route).
  const isSelf = Boolean(employeeRecordId) && employeeId === employeeRecordId;
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => apiRequest<DetailResponse>(`/admin/employees/${employeeId}`),
    enabled: Boolean(employeeId),
  });
  const departments = useQuery({
    queryKey: ["departments", "active"],
    queryFn: () => apiRequest<DepartmentsResponse>("/departments"),
  });
  const [form, setForm] = useState<Editable | null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [passwordCopied, setPasswordCopied] = useState(false);
  useEffect(() => {
    if (!detail.data?.employee) return;
    const e = detail.data.employee;
    setEmploymentStatus(e.employmentStatus);
    setAccountStatus(e.account?.accountStatus ?? "");
    setForm({
      firstNameEn: e.firstNameEn,
      lastNameEn: empty(e.lastNameEn),
      fullNameBn: empty(e.fullNameBn),
      dateOfBirth: empty(e.dateOfBirth),
      gender: e.gender ?? "",
      bloodGroup: e.bloodGroup ?? "",
      nationalId: empty(e.nationalId),
      phone: empty(e.phone),
      email: empty(e.email),
      presentAddress: empty(e.presentAddress),
      permanentAddress: empty(e.permanentAddress),
      designation: empty(e.designation),
      joiningDate: empty(e.joiningDate),
      fatherName: empty(e.fatherName),
      motherName: empty(e.motherName),
      religion: empty(e.religion),
      maritalStatus: e.maritalStatus ?? "",
      departmentId: e.department?.id ?? "",
    });
  }, [detail.data]);
  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error("Employee information is not loaded.");
      const payload: Record<string, string | null> = { ...form };
      for (const [key, value] of Object.entries(payload)) {
        if (value === "") {
          if (["gender", "bloodGroup", "departmentId"].includes(key))
            delete payload[key];
          else payload[key] = null;
        }
      }
      return apiRequest<{ employee: Employee; changed: boolean }>(
        `/admin/employees/${employeeId}`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
    },
    onSuccess: async () => {
      setSavedMessage("Employee information saved.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["my-profile"] }),
      ]);
    },
  });
  function update<K extends keyof Editable>(key: K, value: Editable[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setSavedMessage("");
  }
  const updateStatus = useMutation({
    mutationFn: () => {
      const payload: StatusUpdate = { employmentStatus };
      const currentAccountStatus = detail.data?.employee.account?.accountStatus;
      if (currentAccountStatus && accountStatus !== currentAccountStatus)
        payload.accountStatus = accountStatus;
      if (statusReason.trim()) payload.reason = statusReason.trim();
      return apiRequest<{ employee: Employee; changed: boolean }>(
        `/admin/employees/${employeeId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: async (result) => {
      setStatusMessage(
        result.changed
          ? "Employment and account status updated."
          : "No status changes were needed.",
      );
      setStatusReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["my-profile"] }),
      ]);
    },
  });
  const resetPassword = useMutation({
    mutationFn: () =>
      apiRequest<PasswordResetResponse>(
        `/admin/employees/${employeeId}/password-reset`,
        { method: "POST" },
      ),
    onSuccess: async (result) => {
      setTemporaryPassword(result.temporaryPassword);
      setPasswordCopied(false);
      await queryClient.invalidateQueries({
        queryKey: ["employee", employeeId],
      });
    },
  });
  async function copyTemporaryPassword() {
    await navigator.clipboard.writeText(temporaryPassword);
    setPasswordCopied(true);
  }

  if (!employeeId)
    return (
      <section className="workspace-page">
        <h1>{tr("My profile")}</h1>
        <p role="alert">
          {tr("No employee profile is linked to this account.")}
        </p>
      </section>
    );

  if (detail.isPending)
    return (
      <section className="workspace-page">
        <p>{tr("Loading employee record…")}</p>
      </section>
    );
  if (detail.isError)
    return (
      <section className="workspace-page">
        <p className="form-error" role="alert">
          {tr(safeError(detail.error))}
        </p>
        <Link className="secondary-link-button" to={backTarget}>
          {tr(backLabel)}
        </Link>
      </section>
    );
  const employee = detail.data.employee;
  if (!form)
    return (
      <section className="workspace-page">
        <p>{tr("Preparing employee record…")}</p>
      </section>
    );
  // Only the root administrator can change the root record. Everyone else sees it exactly
  // like an employee sees their own profile: view-only, with no forms to submit.
  if (
    isReadOnlyRootRecord({
      recordIsRoot: employee.account?.isRoot,
      rootAdmin,
      isSelf,
    })
  )
    return (
      <section className="workspace-page">
        <div className="page-heading page-heading-row">
          <div>
            <h1>
              {employee.firstNameEn} {employee.lastNameEn ?? ""}
            </h1>
            <p className="page-description">
              {tr(
                "This is the main administrator's record. You can view it but not change it.",
              )}
            </p>
          </div>
          <Link className="secondary-link-button" to={backTarget}>
            {tr(backLabel)}
          </Link>
        </div>
        <RecordSectionLinks />
        <ProfilePhoto
          imageUrl={employee.profileImageUrl}
          name={`${employee.firstNameEn} ${employee.lastNameEn ?? ""}`.trim()}
        />
        <ReadOnlyRecordSections
          profile={employee}
          records={detail.data.records}
          spouse={detail.data.spouse}
        />
      </section>
    );
  return (
    <section className="workspace-page">
      <div className="page-heading page-heading-row">
        <div>
          <h1>
            {employee.firstNameEn} {employee.lastNameEn ?? ""}
          </h1>
          <p className="page-description">
            {tr("Official employee ID:")}
            {tr(" ")}
            <strong className="mono-cell">{employee.officialEmployeeId}</strong>
            {tr(" ")}
            {tr("· This employee ID cannot be changed.")}
          </p>
        </div>
        <Link className="secondary-link-button" to={backTarget}>
          {tr(backLabel)}
        </Link>
      </div>
      <RecordSectionLinks showAccount={!isSelf} />
      {ownProfile && (
        <ProfileImageEditor
          imageUrl={employee.profileImageUrl}
          endpoint={`/admin/employees/${employeeId}/profile-image`}
          onChanged={() =>
            Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["employee", employeeId],
              }),
              queryClient.invalidateQueries({ queryKey: ["my-profile"] }),
            ])
          }
        />
      )}
      <div className="detail-summary">
        <div>
          <span>{tr("Department")}</span>
          <strong>{employee.department?.nameEn ?? "—"}</strong>
        </div>
        <div>
          <span>{tr("Employment status")}</span>
          <strong>{employee.employmentStatus.replaceAll("_", " ")}</strong>
        </div>
        <div>
          <span>{tr("Account status")}</span>
          <strong>{employee.account?.accountStatus ?? "—"}</strong>
        </div>
        <div>
          <span>{tr("First login password change")}</span>
          <strong>
            {tr(
              employee.account?.mustChangePassword ? "Required" : "Completed",
            )}
          </strong>
        </div>
      </div>
      <form
        className="employee-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-section">
          <div className="form-section-heading">
            <h2>{tr("Employment information")}</h2>
            <p>{tr("The official employee ID cannot be changed.")}</p>
          </div>
          <div className="form-grid">
            <label>
              {tr("Official employee ID")}
              <input value={employee.officialEmployeeId} disabled readOnly />
            </label>
            <label>
              {tr("Department")}
              <select
                disabled={!fullAdmin}
                value={form.departmentId}
                onChange={(e) => update("departmentId", e.target.value)}
              >
                <option value="">{tr("No department")}</option>
                {departments.data?.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameEn}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr("Designation")}
              <input
                maxLength={150}
                value={form.designation}
                onChange={(e) => update("designation", e.target.value)}
              />
            </label>
            <label>
              {tr("Joining date")}
              <input
                type="date"
                value={form.joiningDate}
                onChange={(e) => update("joiningDate", e.target.value)}
              />
            </label>
          </div>
        </div>
        <div
          id="record-personal"
          className="form-section record-section-target"
          tabIndex={-1}
        >
          <div className="form-section-heading">
            <h2>{tr("Personal details")}</h2>
          </div>
          <div className="form-grid">
            <label>
              {tr("First name (English) *")}
              <input
                required
                maxLength={100}
                value={form.firstNameEn}
                onChange={(e) => update("firstNameEn", e.target.value)}
              />
            </label>
            <label>
              {tr("Last name (English)")}
              <input
                maxLength={100}
                value={form.lastNameEn}
                onChange={(e) => update("lastNameEn", e.target.value)}
              />
            </label>
            <label>
              {tr("Full name (বাংলা)")}
              <input
                maxLength={200}
                value={form.fullNameBn}
                onChange={(e) => update("fullNameBn", e.target.value)}
              />
            </label>
            <label>
              {tr("Date of birth")}
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)}
              />
            </label>
            <label>
              {tr("Gender")}
              <select
                value={form.gender}
                onChange={(e) => update("gender", e.target.value)}
              >
                <option value="">{tr("Not specified")}</option>
                <option value="MALE">{tr("Male")}</option>
                <option value="FEMALE">{tr("Female")}</option>
                <option value="OTHER">{tr("Other")}</option>
              </select>
            </label>
            <label>
              {tr("Blood group")}
              <select
                value={form.bloodGroup}
                onChange={(e) => update("bloodGroup", e.target.value)}
              >
                <option value="">{tr("Not specified")}</option>
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
                value={form.nationalId}
                onChange={(e) => update("nationalId", e.target.value)}
              />
            </label>
            <label>
              {tr("Phone")}
              <input
                type="tel"
                maxLength={30}
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </label>
            <label>
              {tr("Email")}
              <input
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </label>
            <label>
              {tr("Father's name")}
              <input
                maxLength={200}
                value={form.fatherName}
                onChange={(e) => update("fatherName", e.target.value)}
              />
            </label>
            <label>
              {tr("Mother's name")}
              <input
                maxLength={200}
                value={form.motherName}
                onChange={(e) => update("motherName", e.target.value)}
              />
            </label>
            <label>
              {tr("Religion")}
              <input
                maxLength={50}
                value={form.religion}
                onChange={(e) => update("religion", e.target.value)}
              />
            </label>
            <label>
              {tr("Marital status")}
              <select
                value={form.maritalStatus}
                onChange={(e) => update("maritalStatus", e.target.value)}
              >
                <option value="">{tr("Not specified")}</option>
                <option value="SINGLE">{tr("Single")}</option>
                <option value="MARRIED">{tr("Married")}</option>
                <option value="DIVORCED">{tr("Divorced")}</option>
                <option value="WIDOWED">{tr("Widowed")}</option>
              </select>
            </label>
            <label className="form-field-wide">
              {tr("Present address")}
              <textarea
                rows={3}
                maxLength={1000}
                value={form.presentAddress}
                onChange={(e) => update("presentAddress", e.target.value)}
              />
            </label>
            <label className="form-field-wide">
              {tr("Permanent address")}
              <textarea
                rows={3}
                maxLength={1000}
                value={form.permanentAddress}
                onChange={(e) => update("permanentAddress", e.target.value)}
              />
            </label>
          </div>
        </div>
        {save.isError && (
          <p className="form-error" role="alert">
            {tr(safeError(save.error))}
          </p>
        )}
        {savedMessage && (
          <p className="form-success" role="status">
            {savedMessage}
          </p>
        )}
        <div className="form-actions">
          <button
            className="auth-submit form-submit"
            type="submit"
            disabled={save.isPending}
          >
            {tr(save.isPending ? "Saving changes…" : "Save changes")}
          </button>
          <Link className="secondary-link-button" to={backTarget}>
            {tr("Cancel")}
          </Link>
        </div>
      </form>
      <EmployeePdsPanel
        employeeId={employeeId}
        maritalStatus={employee.maritalStatus}
        records={detail.data.records}
        spouse={detail.data.spouse}
        departments={departments.data?.departments ?? []}
      />
      {isSelf ? (
        <p className="field-help">
          {tr("You cannot change your own employment or account status.")}
        </p>
      ) : (
        <section
          id="record-account"
          className="form-section access-management record-section-target"
          tabIndex={-1}
        >
          <div className="form-section-heading">
            <h2>{tr("Employment and account access")}</h2>
            <p>
              {tr(
                "If an employee is not active, they are signed out and cannot sign in. If they become active again, turn their account on separately.",
              )}
            </p>
          </div>
          <form
            className="employee-form status-management-form"
            onSubmit={(event) => {
              event.preventDefault();
              updateStatus.mutate();
            }}
          >
            <div className="form-grid">
              <label>
                {tr("Employment status")}
                <select
                  value={employmentStatus}
                  onChange={(event) => {
                    setEmploymentStatus(event.target.value);
                    setStatusMessage("");
                  }}
                >
                  <option value="ACTIVE">{tr("Active")}</option>
                  <option value="TRANSFERRED_OUT">
                    {tr("Transferred out")}
                  </option>
                  <option value="RETIRED">{tr("Retired")}</option>
                  <option value="RESIGNED">{tr("Resigned")}</option>
                  <option value="SUSPENDED">{tr("Suspended")}</option>
                  <option value="DECEASED">{tr("Deceased")}</option>
                </select>
              </label>
              {employee.account && (
                <label>
                  {tr("Login account status")}
                  <select
                    value={accountStatus}
                    onChange={(event) => {
                      setAccountStatus(event.target.value);
                      setStatusMessage("");
                    }}
                  >
                    <option
                      value="ACTIVE"
                      disabled={
                        employmentStatus !== "ACTIVE" &&
                        accountStatus !== "ACTIVE"
                      }
                    >
                      {tr("Active")}
                    </option>
                    <option value="DISABLED">{tr("Disabled")}</option>
                    <option value="LOCKED">{tr("Locked")}</option>
                  </select>
                </label>
              )}
              <label className="form-field-wide">
                {tr("Reason (optional)")}
                <textarea
                  rows={2}
                  maxLength={500}
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder={tr("Record the reason for this status change")}
                />
              </label>
            </div>
            {updateStatus.isError && (
              <p className="form-error" role="alert">
                {tr(safeError(updateStatus.error))}
              </p>
            )}
            {statusMessage && (
              <p className="form-success" role="status">
                {statusMessage}
              </p>
            )}
            <div className="form-actions">
              <button
                className="auth-submit form-submit"
                type="submit"
                disabled={updateStatus.isPending}
              >
                {tr(
                  updateStatus.isPending ? "Updating status…" : "Save status",
                )}
              </button>
            </div>
          </form>
          {employee.account && employee.account.role !== "ADMIN" && (
            <div className="password-reset-panel">
              <div>
                <h3>{tr("Reset login password")}</h3>
                <p>
                  {tr(
                    "Give the employee a new temporary password. They will be signed out and must set a new password when they sign in again.",
                  )}
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={
                  resetPassword.isPending ||
                  employee.employmentStatus !== "ACTIVE" ||
                  employee.account.accountStatus !== "ACTIVE"
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Give this employee a new temporary password? They will be signed out.",
                    )
                  ) {
                    setTemporaryPassword("");
                    resetPassword.mutate();
                  }
                }}
              >
                {tr(resetPassword.isPending ? "Generating…" : "Reset password")}
              </button>
              {resetPassword.isError && (
                <p className="form-error" role="alert">
                  {tr(safeError(resetPassword.error))}
                </p>
              )}
              {temporaryPassword && (
                <div className="credential-card reset-credential">
                  <p>
                    <strong>{tr("Temporary password")}</strong>
                    <code>{temporaryPassword}</code>
                  </p>
                  <p className="form-success">
                    {tr(
                      "This password is shown only once. Copy it and give it to the employee.",
                    )}
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void copyTemporaryPassword()}
                  >
                    {tr(passwordCopied ? "Copied" : "Copy password")}
                  </button>
                </div>
              )}
              {(employee.employmentStatus !== "ACTIVE" ||
                employee.account.accountStatus !== "ACTIVE") && (
                <p className="field-help">
                  {tr(
                    "You can reset the password only when the employee and their account are both Active.",
                  )}
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {rootAdmin &&
        !ownProfile &&
        employee.account &&
        !employee.account.isRoot && (
          <AdminAccessForm
            key={employee.id}
            employeeId={employee.id}
            accessLevel={employee.account.adminScope}
            departmentId={employee.account.administeredDepartmentId}
          />
        )}
    </section>
  );
}
