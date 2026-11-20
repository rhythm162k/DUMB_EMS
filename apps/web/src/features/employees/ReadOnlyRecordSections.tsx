import { tr } from "../../i18n/language";

export type ReadOnlyRecordData = {
  profile: Record<string, unknown>;
  records: Record<string, Record<string, unknown>[]>;
  spouse: Record<string, unknown> | null;
};
const labels: Record<string, string> = {
  officialEmployeeId: "Employee ID",
  firstNameEn: "First name (English)",
  lastNameEn: "Last name (English)",
  fullNameBn: "Name (Bangla)",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  bloodGroup: "Blood group",
  nationalId: "National ID",
  phone: "Phone",
  email: "Email",
  presentAddress: "Present address",
  permanentAddress: "Permanent address",
  designation: "Designation",
  joiningDate: "Joining date",
  fatherName: "Father's name",
  motherName: "Mother's name",
  religion: "Religion",
  maritalStatus: "Marital status",
  employmentStatus: "Employment status",
};
const sectionLabels: Record<string, string> = {
  academicQualifications: "Academic qualifications",
  trainingRecords: "Training",
  serviceHistory: "Service history",
  postingHistory: "Posting history",
  professionalMemberships: "Professional memberships",
  publications: "Publications",
};
function readable(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (s) => s.toUpperCase());
}
function valueText(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "object")
    return (
      Object.values(v)
        .filter((x) => typeof x === "string")
        .join(" · ") || "—"
    );
  return String(v);
}
/** Read-only view of an employee record: personal details, spouse and service records. */
export default function ReadOnlyRecordSections({
  profile,
  records,
  spouse,
}: ReadOnlyRecordData) {
  return (
    <>
      <h2
        id="record-personal"
        className="self-heading record-section-target"
        tabIndex={-1}
      >
        {tr("Personal and employment details")}
      </h2>
      <div className="profile-grid">
        {Object.entries(labels).map(([key, label]) => (
          <div className="profile-field" key={key}>
            <span>{tr(label)}</span>
            <strong>
              {["gender", "maritalStatus", "employmentStatus"].includes(key)
                ? tr(valueText(profile[key]))
                : valueText(profile[key])}
            </strong>
          </div>
        ))}
        <div className="profile-field">
          <span>{tr("Department")}</span>
          <strong>
            {valueText(
              (profile.department as { nameEn?: string } | null)?.nameEn,
            )}
          </strong>
        </div>
      </div>
      <h2 className="self-heading">{tr("Spouse")}</h2>
      {spouse ? (
        <div className="profile-grid">
          {Object.entries(spouse)
            .filter(
              ([k]) =>
                ![
                  "id",
                  "employeeId",
                  "createdAt",
                  "updatedAt",
                  "departmentId",
                ].includes(k),
            )
            .map(([key, value]) => (
              <div className="profile-field" key={key}>
                <span>{tr(readable(key))}</span>
                <strong>{valueText(value)}</strong>
              </div>
            ))}
        </div>
      ) : (
        <p className="self-empty">{tr("No spouse record.")}</p>
      )}
      <h2
        id="record-service"
        className="self-heading record-section-target"
        tabIndex={-1}
      >
        {tr("Personal and service records")}
      </h2>
      {Object.entries(records).map(([key, items]) => (
        <section className="self-record-section" key={key}>
          <h3>
            {tr(sectionLabels[key] ?? readable(key))}
            <span className="self-count">{items.length}</span>
          </h3>
          {items.length ? (
            items.map((item, index) => (
              <div
                className="profile-grid self-record"
                key={String(item.id ?? index)}
              >
                {Object.entries(item)
                  .filter(
                    ([k]) =>
                      ![
                        "id",
                        "employeeId",
                        "createdAt",
                        "updatedAt",
                        "departmentId",
                      ].includes(k),
                  )
                  .map(([field, value]) => (
                    <div className="profile-field" key={field}>
                      <span>{tr(readable(field))}</span>
                      <strong>{valueText(value)}</strong>
                    </div>
                  ))}
              </div>
            ))
          ) : (
            <p className="self-empty">{tr("No records.")}</p>
          )}
        </section>
      ))}
    </>
  );
}
