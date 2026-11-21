import { genericError, safeError, responseError } from "./lib/public-errors";
import { tr, useLanguage } from "./i18n/language";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import { Icons } from "./app/Icons";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import "./App.css";
import { apiRequest, setCsrfToken as updateApiCsrfToken } from "./lib/api";

const AppWorkspace = /* @__PURE__ */ lazy(() => import("./app/AppWorkspace"));

type ServiceState = "checking" | "online" | "offline";
type AuthUser = {
  id: string;
  role: "ADMIN" | "EMPLOYEE";
  adminScope: "FULL" | "DEPARTMENT" | null;
  isRoot?: boolean;
  administeredDepartmentId: string | null;
  mustChangePassword: boolean;
  employeeRecordId: string | null;
  employeeId: string | null;
  firstName: string | null;
  lastName: string | null;
  employmentStatus: string | null;
};
type SystemStatus = {
  api: ServiceState;
  database: ServiceState;
  checkedAt: Date | null;
};

const initialStatus: SystemStatus = {
  api: "checking",
  database: "checking",
  checkedAt: null,
};

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page ems-auth">
      <header className="ems-auth__hero">
        <div className="ems-auth__body">
          <img
            src="/images/dumb-ems.svg"
            alt="brand-logo"
            height={150}
            width={150}
          />
          <p>{tr("Employee Management System")}</p>
        </div>
      </header>
      <div className="ems-auth__panel">
        <div className="ems-auth__tools">
          <LanguageSwitcher />
        </div>
        <section className="auth-card">{children}</section>
      </div>
    </main>
  );
}

const personas = [
  ["root", "Full Administrator"],
  ["full-admin", "Administrator"],
  ["operations-admin", "Department Administrator", "As Operations Admin"],
  [
    "people-admin",
    "Department Administrator",
    "As People & Administration Admin",
  ],
  ["employee", "Employee"],
] as const;

type Persona = (typeof personas)[number][0];
type DemoSession = {
  persona: Persona;
  csrfToken: string;
  expiresAt: number;
  user: AuthUser;
};

function DemoApp() {
  useLanguage();
  const [session, setSession] = useState<DemoSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const applySession = useCallback((next: DemoSession | null) => {
    updateApiCsrfToken(next?.csrfToken ?? "");
    setSession(next);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      try {
        const result = await apiRequest<DemoSession | { user: null }>(
          "/demo/session",
          { signal },
        );
        if (!signal?.aborted && version === requestVersion.current)
          applySession(result.user ? result : null);
      } catch (failure) {
        if (!signal?.aborted && version === requestVersion.current)
          setError(safeError(failure));
      } finally {
        if (!signal?.aborted && version === requestVersion.current)
          setLoading(false);
      }
    },
    [applySession],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      () => {
        applySession(null);
        setError("Your session has ended. Please select a role to continue.");
      },
      Math.max(0, session.expiresAt * 1000 - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [applySession, session]);

  useEffect(() => {
    if (!session || busy) return;
    const resume = () => void load();
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [busy, load, session]);

  async function action(path: string, persona?: Persona) {
    if (busy) return;
    setBusy(true);
    setError("");
    ++requestVersion.current;
    try {
      const next = await apiRequest<DemoSession>(path, {
        method: "POST",
        ...(persona ? { body: JSON.stringify({ persona }) } : {}),
      });
      window.history.replaceState(null, "", "/");
      applySession(path === "/demo/logout" ? null : next);
    } catch (failure) {
      const message = safeError(failure);
      setError(
        !session && path === "/demo/session" && message === genericError
          ? "Unable to start your session. Please try again."
          : message,
      );
      if (session) await load();
    } finally {
      setBusy(false);
    }
  }

  const choices = (
    <div className="role-list" aria-busy={loading || busy}>
      {personas.map(([key, title, department]) => (
        <button
          key={key}
          className="role-choice"
          type="button"
          disabled={loading || busy || session?.persona === key}
          aria-current={session?.persona === key ? "true" : undefined}
          onClick={() => void action("/demo/session", key)}
        >
          <span className="role-choice__label">
            {tr(title)}
            {department && (
              <span className="role-choice__department">{tr(department)}</span>
            )}
          </span>
          {session?.persona === key ? (
            <span className="role-choice__current">{tr("Current")}</span>
          ) : (
            Icons.arrow
          )}
        </button>
      ))}
    </div>
  );
  const roleStatus = (loading || busy) && (
    <p className="role-progress" role="status">
      {tr(loading ? "Checking your session…" : "Please wait…")}
    </p>
  );
  const feedback = error && (
    <p className="auth-error" role="alert">
      {tr(error)}
    </p>
  );

  if (session)
    return (
      <Suspense
        fallback={
          <p className="auth-loading" role="status">
            {tr("Loading EMS…")}
          </p>
        }
      >
        <AppWorkspace
          key={session.csrfToken}
          user={session.user}
          status={initialStatus}
          isRefreshing={false}
          refreshStatus={() => undefined}
          onLogout={() => void action("/demo/logout")}
          demoSettings={
            <section className="workspace-page session-page">
              <div className="page-heading">
                <h1>{tr("Session settings")}</h1>
              </div>
              {feedback}
              <section className="form-section session-panel">
                <h2>{tr("Switch role")}</h2>
                {choices}
                {roleStatus}
              </section>
              <section className="form-section session-panel">
                <h2>{tr("Reset sample data")}</h2>
                <p>{tr("Resetting removes changes made in this session.")}</p>
                <button
                  className="secondary-link-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        tr("Reset sample data and discard your changes?"),
                      )
                    )
                      void action("/demo/reset");
                  }}
                >
                  {tr("Reset data")}
                </button>
              </section>
            </section>
          }
        />
      </Suspense>
    );

  return (
    <AuthLayout>
      <div className="auth-card-head">
        <h1>{tr("Welcome to EMS")}</h1>
        <p className="auth-description">{tr("Select a role to continue.")}</p>
      </div>
      {choices}
      {roleStatus}
      {feedback}
      <p className="auth-note">
        {tr("Sample records only. Please use sample information.")}
      </p>
    </AuthLayout>
  );
}

function AuthPanel({
  mode,
  csrfToken,
  onAuthenticated,
  onPasswordChanged,
}: {
  mode: "login" | "first-password";
  csrfToken: string;
  onAuthenticated: (user: AuthUser, token: string) => void;
  onPasswordChanged: (token: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (mode === "first-password" && newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        mode === "login"
          ? "/api/v1/auth/login"
          : "/api/v1/auth/first-login/change-password",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(
            mode === "login" ? { employeeId, password } : { newPassword },
          ),
        },
      );
      const payload = await readJson<{
        user?: AuthUser;
        csrfToken?: string;
        error?: { message?: string };
      }>(response);
      if (!response.ok)
        throw new Error(responseError(response.status, payload.error?.message));

      if (mode === "login" && payload.user && payload.csrfToken) {
        onAuthenticated(payload.user, payload.csrfToken);
      } else if (mode === "first-password" && payload.csrfToken) {
        onPasswordChanged(payload.csrfToken);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? safeError(requestError)
          : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="auth-card-head">
        <h1>
          {tr(mode === "login" ? "Sign in to EMS" : "Set your new password")}
        </h1>
        <p className="auth-description">
          {tr(
            mode === "login"
              ? "Sign in with the employee ID and password you were given."
              : "Your temporary password works only once. Set a new password to continue.",
          )}
        </p>
      </div>

      <form className="auth-form" onSubmit={submit}>
        {mode === "login" ? (
          <>
            <label htmlFor="employee-id">{tr("Employee ID")}</label>
            <input
              id="employee-id"
              autoComplete="username"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              placeholder={tr("Enter your employee ID")}
              required
            />
            <label htmlFor="password">{tr("Password")}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={tr("Enter your password")}
              required
            />
          </>
        ) : (
          <>
            <label htmlFor="new-password">{tr("New password")}</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={tr("At least 12 characters")}
              minLength={12}
              required
            />
            <label htmlFor="confirm-password">
              {tr("Confirm new password")}
            </label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder={tr("Enter the new password again")}
              minLength={12}
              required
            />
          </>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {tr(error)}
          </p>
        )}
        <button
          className="auth-submit"
          type="submit"
          disabled={busy || !csrfToken}
        >
          {tr(
            busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Save new password",
          )}
        </button>
      </form>
    </AuthLayout>
  );
}

function LegacyApp() {
  useLanguage();
  const [status, setStatus] = useState<SystemStatus>(initialStatus);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [csrfToken, setCsrfToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [authError, setAuthError] = useState("");

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [healthResponse, readyResponse] = await Promise.all([
        fetch("/api/v1/health", { cache: "no-store" }),
        fetch("/api/v1/ready", { cache: "no-store" }),
      ]);
      setStatus({
        api: healthResponse.ok ? "online" : "offline",
        database: readyResponse.ok ? "online" : "offline",
        checkedAt: new Date(),
      });
    } catch {
      setStatus({ api: "offline", database: "offline", checkedAt: new Date() });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const loadCurrentUser = useCallback(async () => {
    try {
      const csrfResponse = await fetch("/api/v1/auth/csrf", {
        credentials: "include",
      });
      const csrfPayload = await readJson<{ csrfToken: string }>(csrfResponse);
      if (!csrfResponse.ok)
        throw new Error("Unable to connect. Please try again.");
      setCsrfToken(csrfPayload.csrfToken);
      updateApiCsrfToken(csrfPayload.csrfToken);

      const meResponse = await fetch("/api/v1/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (meResponse.ok) {
        const payload = await readJson<{ user: AuthUser }>(meResponse);
        setUser(payload.user);
      } else if (meResponse.status === 401) {
        setUser(null);
      } else {
        throw new Error("Please sign in again to continue.");
      }
    } catch (requestError) {
      setAuthError(
        requestError instanceof Error
          ? safeError(requestError)
          : "Unable to connect. Please try again.",
      );
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadCurrentUser]);

  // Health/ready run once per sign-in (app load) and on the manual refresh button only.
  // Keyed on the user id: session re-checks replace the user object and must not re-run it.
  const statusUserId = user && !user.mustChangePassword ? user.id : null;
  useEffect(() => {
    if (statusUserId) void Promise.resolve().then(refreshStatus);
  }, [statusUserId, refreshStatus]);

  useEffect(() => {
    if (!user) return;

    let lastCheck = Date.now();
    const refresh = () => {
      lastCheck = Date.now();
      void loadCurrentUser();
    };
    const onFocus = () => {
      if (Date.now() - lastCheck >= 5 * 60_000) refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("ems:access-changed", refresh);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ems:access-changed", refresh);
    };
  }, [user, loadCurrentUser]);

  function handleAuthenticated(nextUser: AuthUser, nextToken: string) {
    setUser(nextUser);
    setCsrfToken(nextToken);
    updateApiCsrfToken(nextToken);
    setAuthError("");
  }

  async function handlePasswordChanged(nextToken: string) {
    setCsrfToken(nextToken);
    updateApiCsrfToken(nextToken);
    const response = await fetch("/api/v1/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      setUser(null);
      setAuthError("Your password was changed. Please sign in again.");
      return;
    }
    const payload = await readJson<{ user: AuthUser }>(response);
    setUser(payload.user);
  }

  async function handleLogout() {
    try {
      await apiRequest("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      setCsrfToken("");
      updateApiCsrfToken("");
      await loadCurrentUser();
    }
  }

  if (bootstrapping) {
    return (
      <main className="auth-page">
        <p className="auth-loading">{tr("Connecting to EMS…")}</p>
      </main>
    );
  }

  if (authError && !csrfToken) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>{tr("EMS is unavailable")}</h1>
          <p className="auth-description">{tr(authError)}</p>
          <button
            className="auth-submit"
            onClick={() => {
              setBootstrapping(true);
              setAuthError("");
              void loadCurrentUser();
            }}
          >
            {tr("Retry")}
          </button>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthPanel
        mode="login"
        csrfToken={csrfToken}
        onAuthenticated={handleAuthenticated}
        onPasswordChanged={handlePasswordChanged}
      />
    );
  }

  if (user.mustChangePassword) {
    return (
      <AuthPanel
        mode="first-password"
        csrfToken={csrfToken}
        onAuthenticated={handleAuthenticated}
        onPasswordChanged={handlePasswordChanged}
      />
    );
  }

  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <p className="auth-loading" role="status">
            {tr("Loading EMS…")}
          </p>
        </main>
      }
    >
      <AppWorkspace
        key={`${user.id}:${user.role}:${user.adminScope}:${user.administeredDepartmentId}`}
        user={user}
        status={status}
        refreshStatus={() => void refreshStatus()}
        isRefreshing={isRefreshing}
        onLogout={() => void handleLogout()}
      />
    </Suspense>
  );
}

export default function App() {
  return import.meta.env.MODE === "worker" ? <DemoApp /> : <LegacyApp />;
}
