import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { Icons } from "../../app/Icons";
import ProfilePhoto from "./ProfilePhoto";

export type MyProfile = {
  officialEmployeeId: string;
  firstNameEn: string;
  lastNameEn: string | null;
  fullNameBn: string | null;
  profileImageUrl: string | null;
  designation: string | null;
  department: { nameEn: string | null } | null;
  phone: string | null;
  email: string | null;
  joiningDate: string | null;
  bloodGroup: string | null;
  gender: string | null;
  employmentStatus: string;
};

// The signed-in person's own profile card, shown at the top of every dashboard (employees and
// all administrator levels). It reads the session-derived /me/profile, so no ID is supplied.
// It shares its query cache with the profile pages, so a new photo shows up here right away.
export default function MyProfileCard({
  linkLabel = "View and download my information →",
  roleLabel,
}: {
  linkLabel?: string;
  /** Administrator level shown beside the status chip. Omitted for ordinary employees. */
  roleLabel?: string;
}) {
  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiRequest<{ profile: MyProfile }>("/me/profile"),
  });
  if (profile.isPending)
    return (
      <div
        className="dash-skel dash-skel--panel"
        role="status"
        aria-label={tr("Loading your profile…")}
      />
    );
  if (profile.isError)
    return (
      <div className="dash-error" role="alert">
        <p>{tr(safeError(profile.error))}</p>
        <button className="ems-btn" onClick={() => void profile.refetch()}>
          {Icons.refresh}
          {tr("Retry profile")}
        </button>
      </div>
    );

  const person = profile.data.profile;
  const name = [person.firstNameEn, person.lastNameEn]
    .filter(Boolean)
    .join(" ");
  const details = [
    ["Department", person.department?.nameEn],
    ["Designation", person.designation],
    ["Gender", person.gender],
    ["Email", person.email],
    ["Joined", person.joiningDate],
    ["Blood group", person.bloodGroup],
  ].filter(([, value]) => value);

  return (
    <article className="me-card" aria-label={tr("Your employee profile")}>
      <div className="me-card__body">
        <div className="me-card__photo">
          <ProfilePhoto imageUrl={person.profileImageUrl} name={name} />
        </div>
        <h2 className="me-card__name">{name || "Employee"}</h2>
        {person.fullNameBn && (
          <p className="me-card__bn" lang="bn">
            {person.fullNameBn}
          </p>
        )}
        <p className="me-card__id">
          {tr("Employee ID · ")}
          <strong>{person.officialEmployeeId}</strong>
        </p>
        {person.phone && <p className="me-card__phone">{person.phone}</p>}
        <div className="me-card__badges">
          <span className="me-status">{tr(person.employmentStatus)}</span>
          {roleLabel && <span className="me-role">{tr(roleLabel)}</span>}
        </div>
      </div>
      <dl className="me-details">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{tr(label)}</dt>
            <dd>{label === "Gender" ? tr(value) : value}</dd>
          </div>
        ))}
      </dl>
      <Link className="me-card__link" to="/profile">
        {tr(linkLabel)}
      </Link>
    </article>
  );
}
