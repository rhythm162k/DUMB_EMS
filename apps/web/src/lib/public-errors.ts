// Keep reviewed public copy aligned with the API error boundary.
const publicMessages = [
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
  "This employee has an overlapping leave record.",
  "The demo accepts up to 12 rows per import.",
  "Formulas are not accepted. Paste values before importing.",
  "Store employee IDs as text so leading zeroes are kept.",
  "Add at least one data row to the template.",
  "A spreadsheet can have at most 1000 rows.",
] as const;
export const genericError = publicMessages[0];
const messagesByCode = new Map([
  ["EMPLOYEE_ID_TAKEN", "An employee with this ID already exists."],
  [
    "DEPARTMENT_NAME_TAKEN",
    "A department with this English name already exists.",
  ],
  [
    "DEPARTMENT_INVALID",
    "The selected department was not found or is inactive.",
  ],
  [
    "SPOUSE_REQUIRES_MARRIED",
    "Set the marital status to Married before adding spouse information.",
  ],
  [
    "SPOUSE_RECORD_EXISTS",
    "Remove the spouse record before changing the marital status from Married.",
  ],
  ["IMPORT_CONFLICT", "Records changed during import. Preview the file again."],
  [
    "PREVIEW_UNAVAILABLE",
    "Preview expired or already committed. Upload the file again.",
  ],
  [
    "PREVIEW_EXPIRED",
    "Preview expired or already committed. Upload the file again.",
  ],
  ["INVALID_IMAGE", "Choose a valid JPG, PNG or WebP photo."],
  ["EXPORT_LIMIT", "Select fewer employees and try again."],
  ["DUPLICATE_REQUEST", "A request is already waiting for review."],
]);
const allowed = new Set<string>([
  ...publicMessages,
  ...messagesByCode.values(),
  "Could not open this image.",
  "Could not resize this image. Choose a smaller photo.",
]);
export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : error;
  return typeof message === "string" && allowed.has(message)
    ? message
    : genericError;
}
export function responseError(
  status: number,
  message?: unknown,
  code?: string,
): string {
  if (status >= 500) return genericError;
  const specific = code && messagesByCode.get(code);
  if (specific) return specific;
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
