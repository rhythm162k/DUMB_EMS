import { tr } from "../../i18n/language";
import { useState } from "react";

export default function ProfilePhoto({
  imageUrl,
  name = "Employee",
}: {
  imageUrl: string | null;
  name?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photoUrl = failedUrl === imageUrl ? null : imageUrl;
  return (
    <div
      className={
        photoUrl ? "profile-photo" : "profile-photo profile-photo--placeholder"
      }
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={`${name} profile`}
          onError={() => setFailedUrl(photoUrl)}
        />
      ) : (
        <span>{tr(imageUrl ? "Photo unavailable" : "No photo")}</span>
      )}
    </div>
  );
}
