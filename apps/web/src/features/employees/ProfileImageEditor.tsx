import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiImageRequest } from "../../lib/api";

import ProfilePhoto from "./ProfilePhoto";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export default function ProfileImageEditor({
  imageUrl,
  endpoint,
  onChanged,
}: {
  imageUrl: string | null;
  endpoint: string;
  onChanged: () => Promise<unknown> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const upload = useMutation({
    mutationFn: () => apiImageRequest(endpoint, "POST", file ?? undefined),
    onSuccess: async () => {
      setFile(null);
      setPreviewUrl(null);
      if (input.current) input.current.value = "";
      setMessage("Profile image updated.");
      await onChanged();
    },
    onError: (e: Error) => setError(safeError(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiImageRequest(endpoint, "DELETE"),
    onSuccess: async () => {
      setFile(null);
      setPreviewUrl(null);
      if (input.current) input.current.value = "";
      setMessage("Profile image removed.");
      await onChanged();
    },
    onError: (e: Error) => setError(safeError(e)),
  });
  const busy = upload.isPending || remove.isPending;
  return (
    <section className="image-editor" aria-label={tr("Profile image")}>
      <ProfilePhoto imageUrl={previewUrl ?? imageUrl} />
      <div className="image-editor-controls">
        <h2>{tr("Profile image")}</h2>
        <p className="field-help">
          {tr(
            "Choose a clear passport-size photo (JPG, PNG or WebP, up to 5 MB).",
          )}
        </p>
        <input
          ref={input}
          aria-label={tr("Choose profile image")}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(e) => {
            setError("");
            setMessage("");
            const selected = e.target.files?.[0] ?? null;
            if (
              selected &&
              (!ALLOWED.includes(selected.type) ||
                selected.size > MAX_BYTES ||
                selected.size === 0)
            ) {
              setError(
                "Choose a photo no larger than 5 MB (JPG, PNG or WebP).",
              );
              setFile(null);
              setPreviewUrl(null);
              e.target.value = "";
            } else {
              setFile(selected);
              setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
            }
          }}
        />
        <div className="image-actions">
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => {
              setError("");
              upload.mutate();
            }}
          >
            {tr(upload.isPending ? "Uploading…" : "Upload image")}
          </button>
          {imageUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(tr("Remove this profile image?"))) {
                  setError("");
                  remove.mutate();
                }
              }}
            >
              {tr("Remove image")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error-text">
            {tr(error)}
          </p>
        )}
        {message && <p role="status">{tr(message)}</p>}
      </div>
    </section>
  );
}
