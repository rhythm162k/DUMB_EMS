import type { ZodError } from "zod";
export function validationErrorBody(
  _error: ZodError,
  message = "Please check the information you entered and try again.",
) {
  void _error;
  return { error: { code: "VALIDATION_ERROR", message } };
}
