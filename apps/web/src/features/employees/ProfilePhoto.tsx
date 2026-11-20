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
  return (
    <div className="profile-photo">
      {imageUrl && failedUrl !== imageUrl ? (
        <img
          src={imageUrl}
          alt={`${name} profile`}
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <span>{tr(imageUrl ? "Photo unavailable" : "No photo")}</span>
      )}
    </div>
  );
}
