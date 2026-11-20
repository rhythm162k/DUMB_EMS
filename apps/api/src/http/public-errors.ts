import type { RequestHandler } from "express";

// Security boundary: only reviewed public copy is returned, never exception text.
export const publicMessages = [
  "Something went wrong. Please try again. If the problem continues, contact your administrator.",
  "Please check the information you entered and try again.",
  "Please sign in again to continue.",
  "You do not have permission to do this.",
  "The requested information could not be found.",
  "This information has changed. Refresh the page and try again.",
  "Please choose a smaller file and try again.",
  "This file could not be opened. Please choose a supported file and try again.",
  "Too many attempts. Please wait a while and try again.",
  "Please refresh the page and try again.",
  "Employee ID or password is incorrect.",
  "Current password is incorrect.",
  "Password must be at least 12 characters.",
  "This password is too long. Please choose a shorter password with at least 12 characters.",
  "The new passwords do not match.",
  "Change your temporary password before continuing.",
  "An employee with this ID already exists.",
  "A department with this English name already exists.",
  "The official employee ID cannot be changed.",
  "The selected department was not found or is inactive.",
  "Only active employees can receive a new temporary password.",
  "Enable the account before issuing a new temporary password.",
  "This employee does not have a login account.",
  "Choose a photo no larger than 5 MB (JPG, PNG or WebP).",
  "Choose a spreadsheet no larger than 2 MB (.xlsx or .csv).",
  "Please check this row in your spreadsheet and try again.",
  "End date cannot precede start date.",
  "Correct preview errors before importing.",
  "Remove the spouse record before changing the marital status from Married.",
  "Set the marital status to Married before adding spouse information.",
  "Invalid data entry. Please check your spreadsheet and try again.",
  "Records changed during import. Preview the file again.",
  "Preview expired or already committed. Upload the file again.",
  "Formulas are not accepted. Paste values before importing.",
  "Store employee IDs as text so leading zeroes are kept.",
  "Add at least one data row to the template.",
  "A spreadsheet can have at most 1000 rows.",
] as const;
const allowed = new Set<string>(publicMessages);
export function publicErrorMessage(status: number, message?: unknown): string {
  if (status >= 500) return publicMessages[0];
  if (typeof message === "string" && allowed.has(message)) return message;
  if (status === 401) return publicMessages[2];
  if (status === 403) return publicMessages[3];
  if (status === 404) return publicMessages[4];
  if (status === 409) return publicMessages[5];
  if (status === 413) return publicMessages[6];
  if (status === 415) return publicMessages[7];
  if (status === 429) return publicMessages[8];
  return publicMessages[1];
}

// Installed before parsers, sessions and routes so their failures are covered too.
export const protectErrorResponses: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) {
      const error = (
        body as { error?: { code?: unknown; message?: unknown } } | null
      )?.error;
      // Codes are a fixed application contract, not database/exception codes.
      const code =
        typeof error?.code === "string" && publicCodes.has(error.code)
          ? error.code
          : "REQUEST_FAILED";
      return json({
        error: {
          code,
          message: publicErrorMessage(res.statusCode, error?.message),
        },
      });
    }
    return json(body);
  };
  next();
};

const publicCodes = new Set([
  "ACCOUNT_NOT_ACTIVE",
  "ACCOUNT_UNAVAILABLE",
  "ACTIVE_EMPLOYEE_REQUIRED",
  "ADMIN_ACCOUNT_PROTECTED",
  "ROOT_ADMIN_PROTECTED",
  "CSRF_TOKEN_INVALID",
  "CSRF_TOKEN_MISSING",
  "CURRENT_PASSWORD_INVALID",
  "DEPARTMENT_INVALID",
  "DEPARTMENT_NAME_TAKEN",
  "DEPARTMENT_NOT_FOUND",
  "EMPLOYEE_ACCOUNT_NOT_FOUND",
  "EMPLOYEE_ID_IMMUTABLE",
  "EMPLOYEE_ID_TAKEN",
  "EMPLOYEE_NOT_ACTIVE",
  "EMPLOYEE_NOT_FOUND",
  "FORBIDDEN",
  "IMAGE_NOT_FOUND",
  "IMPORT_CONFLICT",
  "IMPORT_INVALID",
  "INTERNAL_ERROR",
  "INVALID_CREDENTIALS",
  "INVALID_IMAGE",
  "LOGIN_RATE_LIMITED",
  "NOT_FOUND",
  "NO_ACCOUNT",
  "NO_PROFILE_IMAGE",
  "ORIGIN_NOT_ALLOWED",
  "PASSWORD_CHANGE_NOT_REQUIRED",
  "PASSWORD_CHANGE_REQUIRED",
  "PASSWORD_RATE_LIMITED",
  "PAYLOAD_TOO_LARGE",
  "PROFILE_NOT_FOUND",
  "RECORD_NOT_FOUND",
  "RESET_RATE_LIMITED",
  "SECTION_NOT_FOUND",
  "SPOUSE_NOT_FOUND",
  "SPOUSE_RECORD_EXISTS",
  "SPOUSE_REQUIRES_MARRIED",
  "STATUS_CONFLICT",
  "UNAUTHENTICATED",
  "UNSUPPORTED_MEDIA_TYPE",
  "VALIDATION_ERROR",
]);

for (const code of [
  "NO_CHANGE",
  "DUPLICATE_REQUEST",
  "REQUEST_UNAVAILABLE",
  "REQUEST_INVALID",
  "CHANGE_CONFLICT",
  "IMPORT_CONFLICT",
  "PREVIEW_EXPIRED",
  "PREVIEW_UNAVAILABLE",
])
  publicCodes.add(code);
