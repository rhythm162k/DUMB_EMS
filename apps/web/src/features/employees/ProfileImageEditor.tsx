import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiImageRequest } from "../../lib/api";

import ProfilePhoto from "./ProfilePhoto";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

async function resizeProfileImage(file: File): Promise<File> {
  const image = await createImageBitmap(file).catch(() => {
    throw new Error("Could not open this image.");
  });
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 512 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not open this image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.72, 0.6, 0.45]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= (quality === 0.45 ? 192 : 120) * 1024)
        return new File([blob], "profile.jpg", { type: "image/jpeg" });
    }
    throw new Error("Could not resize this image. Choose a smaller photo.");
  } finally {
    image.close();
  }
}

export default function ProfileImageEditor({
  imageUrl,
  endpoint,
  onChanged,
}: {
  imageUrl: string | null;
  endpoint: string;
  onChanged: () => Promise<unknown> | void;
}) {
  const photoHelp = useId();
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
    mutationFn: async () => {
      if (!file) return;
      const prepared =
        import.meta.env.MODE === "worker"
          ? await resizeProfileImage(file)
          : file;
      await apiImageRequest(endpoint, "POST", prepared);
    },
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
        <p className="field-help" id={photoHelp}>
          {tr("Choose a clear photo (JPG, PNG or WebP, up to 5 MB).")}
        </p>
        <span className="file-control">
          <input
            ref={input}
            aria-label={tr("Choose profile image")}
            aria-describedby={photoHelp}
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
          <span className="file-control__button" aria-hidden="true">
            {tr("Browse files")}
          </span>
          <span className="file-control__name" aria-hidden="true">
            {file?.name ?? tr("No file selected")}
          </span>
        </span>
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
