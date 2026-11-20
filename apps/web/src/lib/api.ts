import { responseError } from "./public-errors";
export type ApiErrorBody = { error?: { code?: string; message?: string } };

let csrfToken = "";

export function setCsrfToken(token: string) {
  csrfToken = token;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (
    csrfToken &&
    init.method &&
    !["GET", "HEAD", "OPTIONS"].includes(init.method.toUpperCase())
  ) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(
    path.startsWith("/api/") ? path : `/api/v1${path}`,
    {
      ...init,
      headers,
      credentials: "include",
      cache: "no-store",
    },
  );

  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    throw new Error(responseError(response.status, payload.error?.message));
  }
  return payload;
}

export async function apiImageRequest(
  path: string,
  method: "POST" | "DELETE",
  file?: File,
): Promise<void> {
  const headers = new Headers();

  if (csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  // The API accepts raw image bytes, not multipart/form-data.
  if (file) headers.set("Content-Type", file.type);
  const body = file;

  const response = await fetch(
    path.startsWith("/api/") ? path : `/api/v1${path}`,
    {
      method,
      headers,
      body,
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;

    throw new Error(responseError(response.status, payload.error?.message));
  }
}

export async function downloadProfileCsv(): Promise<void> {
  const response = await fetch("/api/v1/me/data/profile.csv", {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(responseError(response.status, payload.error?.message));
  }
  if (!response.headers.get("content-type")?.includes("text/csv")) {
    throw new Error(
      "Something went wrong. Please try again. If the problem continues, contact your administrator.",
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "my-ems-profile.csv";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export async function apiFileRequest<T>(path: string, file: File): Promise<T> {
  const headers = new Headers({
    // The server decides the format from the file itself; this is only a label.
    "Content-Type": file.name.toLowerCase().endsWith(".xlsx")
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  });
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers,
    body: file,
    credentials: "include",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok)
    throw new Error(responseError(response.status, payload.error?.message));
  return payload;
}
export async function downloadData(
  path: string,
  filename: string,
  body?: Record<string, string>,
): Promise<void> {
  const headers = new Headers();
  if (body) {
    headers.set("Content-Type", "application/json");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(responseError(response.status, payload.error?.message));
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/csv") && !type.includes("spreadsheetml.sheet"))
    throw new Error(
      "Something went wrong. Please try again. If the problem continues, contact your administrator.",
    );
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
