import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, downloadData } from "../../lib/api";
import ProfileImageEditor from "./ProfileImageEditor";
import ProfilePhoto from "./ProfilePhoto";
import ReadOnlyRecordSections from "./ReadOnlyRecordSections";
import RecordSectionLinks from "./RecordSectionLinks";

type Data = {
  profile: Record<string, unknown>;
  records: Record<string, Record<string, unknown>[]>;
  spouse: Record<string, unknown> | null;
};
export default function SelfServiceProfile({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const client = useQueryClient();
  const download = useMutation({
    mutationFn: (format: "csv" | "xlsx") =>
      downloadData(`/me/data/pds?format=${format}`, `my-ems-pds.${format}`),
  });
  const query = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiRequest<Data>("/me/profile"),
  });
  if (query.isPending)
    return (
      <section className="workspace-page">
        <p className="table-message" role="status">
          {tr("Loading your profile…")}
        </p>
      </section>
    );
  if (query.isError)
    return (
      <section className="workspace-page">
        <p className="error-text" role="alert">
          {tr(safeError(query.error))}
        </p>
      </section>
    );
  const { profile, records, spouse } = query.data;
  const imageUrl =
    typeof profile.profileImageUrl === "string"
      ? profile.profileImageUrl
      : null;
  return (
    <section className="workspace-page">
      <div className="page-heading">
        <h1>{tr("My profile")}</h1>
        {!readOnly && (
          <p className="page-description">
            {tr(
              "To update your details, send a change request. You can change your photo here.",
            )}
          </p>
        )}
      </div>
      <RecordSectionLinks />
      {!readOnly && (
        <div className="profile-export">
          <div className="export-btn">
            <button
              className="refresh-button"
              disabled={download.isPending}
              onClick={() => download.mutate("xlsx")}
            >
              {tr(
                download.isPending
                  ? "Preparing download…"
                  : "Download my information (Excel)",
              )}
            </button>
            <button
              className="refresh-button"
              disabled={download.isPending}
              onClick={() => download.mutate("csv")}
            >
              {tr("Download my information (.csv)")}
            </button>
          </div>
          <p className="field-help">
            {tr(
              "Includes your personal details, spouse information and service records. Private details are left out. Excel puts each part on its own sheet.",
            )}
          </p>
          {download.isError && (
            <p role="alert" className="error-text">
              {tr(safeError(download.error))}
            </p>
          )}
          {download.isSuccess && (
            <p role="status">{tr("Your download has started.")}</p>
          )}
        </div>
      )}
      {readOnly ? (
        <ProfilePhoto
          imageUrl={imageUrl}
          name={[profile.firstNameEn, profile.lastNameEn]
            .filter(Boolean)
            .join(" ")}
        />
      ) : (
        <ProfileImageEditor
          imageUrl={imageUrl}
          endpoint="/me/profile-image"
          onChanged={() =>
            client.invalidateQueries({ queryKey: ["my-profile"] })
          }
        />
      )}
      <ReadOnlyRecordSections
        profile={profile}
        records={records}
        spouse={spouse}
      />
    </section>
  );
}
