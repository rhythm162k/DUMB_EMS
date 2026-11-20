import { safeError } from "../../lib/public-errors";
import { tr } from "../../i18n/language";
import { useState, type FormEvent } from "react";
import { apiRequest, setCsrfToken } from "../../lib/api";
export default function AccountPage() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await apiRequest<{ csrfToken: string }>(
        "/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword: current,
            newPassword: password,
          }),
        },
      );
      setCsrfToken(result.csrfToken);
      setCurrent("");
      setPassword("");
      setConfirm("");
      setMessage(
        "Password changed. You were signed out on your other devices.",
      );
    } catch (e) {
      setError(e instanceof Error ? safeError(e) : "Password change failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-page">
      <div className="page-heading">
        <h1>{tr("Account settings")}</h1>
        <p className="page-description">
          {tr("Change your own sign-in password.")}
        </p>
      </div>
      <form className="form-section employee-form" onSubmit={submit}>
        <div className="form-grid">
          <label>
            {tr("Current password")}
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            {tr("New password")}
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            {tr("Confirm new password")}
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        </div>
        <p className="field-help">{tr("Use at least 12 characters.")}</p>
        {error && (
          <p className="form-error" role="alert">
            {tr(error)}
          </p>
        )}
        {message && <p role="status">{tr(message)}</p>}
        <button className="auth-submit form-submit" disabled={busy}>
          {tr(busy ? "Saving…" : "Change password")}
        </button>
      </form>
    </section>
  );
}
