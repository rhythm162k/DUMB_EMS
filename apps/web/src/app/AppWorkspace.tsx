import { safeError } from "../lib/public-errors";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { apiRequest } from "../lib/api";
import { currentLanguage, num, tr, useLanguage } from "../i18n/language";
import LanguageSwitcher from "../i18n/LanguageSwitcher";
import EmployeeDirectory from "../features/employees/EmployeeDirectory";
import EmployeeCreatePage from "../features/employees/EmployeeCreatePage";
import EmployeeDetailPage from "../features/employees/EmployeeDetailPage";
import ChangeRequestsPage from "../features/employees/ChangeRequestsPage";
import DataToolsPage from "../features/employees/DataToolsPage";
import AccountPage from "../features/employees/AccountPage";
import EmployeeDashboard from "../features/employees/EmployeeDashboard";
import MyProfileCard from "../features/employees/MyProfileCard";
import SelfServiceProfile from "../features/employees/SelfServiceProfile";
import LeavePage from "../features/employees/LeavePage";
import DepartmentsPage from "../features/employees/DepartmentsPage";
import { BrandBlock, BrandMark } from "./Brand";
import { Icons } from "./Icons";

type AuthUser = {
  role: "ADMIN" | "EMPLOYEE";
  adminScope: "FULL" | "DEPARTMENT" | null;
  isRoot?: boolean;
  administeredDepartmentId: string | null;
  employeeId: string | null;
  employeeRecordId: string | null;
  firstName: string | null;
  lastName: string | null;
};
type ServiceState = "checking" | "online" | "offline";
type SystemStatus = {
  api: ServiceState;
  database: ServiceState;
  checkedAt: Date | null;
};
type Props = {
  user: AuthUser;
  status: SystemStatus;
  refreshStatus: () => void;
  isRefreshing: boolean;
  onLogout: () => void;
  demoSettings?: ReactNode;
};

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 20_000 },
    },
  });

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

type AdminStats = {
  employees: number;
  departments: number;
  departmentName?: string | null;
  requests: number;
  onLeave: number;
  active: number;
  available: number;
};

function todayLabel() {
  return new Date().toLocaleDateString(
    currentLanguage() === "bn" ? "bn-BD" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label={tr("Loading overview…")}>
      <div className="dash-skel dash-skel--summary" />
      <div className="dash-split">
        <div className="dash-skel dash-skel--panel" />
        <div className="dash-skel dash-skel--panel" />
      </div>
    </div>
  );
}

function AdminDashboard({
  fullAdmin,
  roleLabel,
  showProfile,
}: {
  fullAdmin: boolean;
  roleLabel: string;
  showProfile: boolean;
}) {
  const stats = useQuery({
    queryKey: ["overview-stats", "ADMIN"],
    queryFn: () => apiRequest<AdminStats>("/overview/stats"),
  });
  const data = stats.data;
  const pending = data?.requests ?? 0;
  const segments = data
    ? [
        { key: "available", label: "Available", value: data.available },
        { key: "leave", label: "On leave", value: data.onLeave },
        {
          key: "inactive",
          label: "Inactive",
          value: Math.max(0, data.employees - data.active),
        },
      ]
    : [];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const availablePct =
    data && total > 0 ? Math.round((data.available / total) * 100) : null;
  const summary = data
    ? [
        { to: "/employees", label: "Employees", value: data.employees },
        ...(fullAdmin
          ? [
              {
                to: "/departments",
                label: "Departments",
                value: data.departments,
              },
            ]
          : []),
        { to: "/leave", label: "On leave today", value: data.onLeave },
      ]
    : [];

  return (
    <section className="workspace-page dash">
      <header className="dash-header">
        <div>
          <h1>{tr("Workforce overview")}</h1>
          <p>
            {[data?.departmentName, todayLabel()].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="dash-header__actions">
          {pending > 0 && (
            <Link className="primary-link-button" to="/change-requests">
              {tr(
                pending === 1
                  ? "Review {count} pending request"
                  : "Review {count} pending requests",
              ).replace("{count}", num(pending))}
            </Link>
          )}
          <Link
            className={
              pending > 0 ? "secondary-link-button" : "primary-link-button"
            }
            to="/employees/new"
          >
            {tr("Add employee")}
          </Link>
        </div>
      </header>

      {stats.isPending ? (
        <DashboardSkeleton />
      ) : stats.isError ? (
        <div className="dash-error" role="alert">
          <p>{tr(safeError(stats.error))}</p>
          <button className="ems-btn" onClick={() => void stats.refetch()}>
            {Icons.refresh}
            {tr("Retry")}
          </button>
        </div>
      ) : (
        <>
          <ul className="dash-summary" aria-label={tr("Workforce summary")}>
            {summary.map((item) => (
              <li key={item.to}>
                <Link to={item.to}>
                  <span>{tr(item.label)}</span>
                  <strong>{num(item.value)}</strong>
                </Link>
              </li>
            ))}
          </ul>

          <div className="dash-split">
            <section className="dash-panel" aria-labelledby="dash-workforce">
              <div className="dash-panel__head">
                <h2 id="dash-workforce">{tr("Workforce today")}</h2>
              </div>
              <div className="dash-ring">
                <p className="dash-ring__value">
                  {availablePct === null ? (
                    "—"
                  ) : (
                    <>
                      {num(availablePct)}
                      <span>%</span>
                    </>
                  )}
                </p>
                <p className="dash-ring__label">{tr("available")}</p>
              </div>
              <div className="dash-bar" aria-hidden="true">
                {segments.map((segment) => (
                  <span
                    key={segment.key}
                    className={`dash-bar__seg dash-bar__seg--${segment.key}`}
                    style={{ flexGrow: segment.value }}
                  />
                ))}
              </div>
              <ul className="dash-legend">
                {segments.map((segment) => (
                  <li key={segment.key}>
                    <span
                      className={`dash-legend__dot dash-bar__seg--${segment.key}`}
                      aria-hidden="true"
                    />
                    <span className="dash-legend__name">
                      {tr(segment.label)}
                    </span>
                    <strong>{num(segment.value)}</strong>
                  </li>
                ))}
              </ul>
            </section>

            <section className="dash-panel" aria-labelledby="dash-actions">
              <div className="dash-panel__head">
                <h2 id="dash-actions">{tr("Quick actions")}</h2>
              </div>
              <ul className="dash-actions">
                {pending === 0 && (
                  <li>
                    <Link className="dash-action" to="/change-requests">
                      {Icons.requests}
                      <span>{tr("Review requests")}</span>
                      <small>{tr("All caught up")}</small>
                    </Link>
                  </li>
                )}
                <li>
                  <Link className="dash-action" to="/leave">
                    {Icons.leave}
                    <span>{tr("Manage leave")}</span>
                  </Link>
                </li>
                <li>
                  <Link className="dash-action" to="/data-tools">
                    {Icons.data}
                    <span>{tr("Import & export")}</span>
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        </>
      )}

      {showProfile && (
        <div className="me-layout me-layout--admin">
          <MyProfileCard roleLabel={roleLabel} />
        </div>
      )}
    </section>
  );
}

function roleLabel(user: AuthUser) {
  if (user.role === "EMPLOYEE") return "Employee";
  if (user.adminScope === "DEPARTMENT") return "Department Administrator";
  return user.isRoot === true ? "Full Administrator" : "Administrator";
}

function Dashboard({ user }: { user: AuthUser }) {
  return user.role === "ADMIN" ? (
    <AdminDashboard
      fullAdmin={user.adminScope === "FULL"}
      roleLabel={roleLabel(user)}
      showProfile={Boolean(user.employeeRecordId)}
    />
  ) : (
    <EmployeeDashboard />
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

type NavDef = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
};

function pageLabel(pathname: string, admin: boolean, demo: boolean): string {
  if (pathname === "/") return "Overview";
  if (pathname === "/employees") return "Employees";
  if (pathname === "/employees/new") return "Add employee";
  if (pathname.startsWith("/employees/")) return "Employee record";
  const map: Record<string, string> = {
    "/profile": "My profile",
    "/leave": admin ? "Manage leave" : "My leave",
    "/change-requests": admin ? "Review requests" : "My change requests",
    "/data-tools": "Import & export",
    "/departments": "Departments",
    "/account": demo ? "Session settings" : "Account settings",
    "/my-leave": "My leave",
    "/my-requests": "My change requests",
  };
  return map[pathname] ?? "Overview";
}

function initials(name: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "E";
}

function UserAvatar({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(imageUrl) && failedUrl !== imageUrl;
  return (
    <span
      className={`ems-avatar${showImage ? " ems-avatar--photo" : ""}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={imageUrl!} alt="" onError={() => setFailedUrl(imageUrl)} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function Workspace({ user, onLogout, demoSettings }: Props) {
  useLanguage();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDialogElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const admin = user.role === "ADMIN";
  const demo = Boolean(demoSettings);
  const fullAdmin = admin && user.adminScope === "FULL";
  // Only the root administrator may grant or change administrator access.
  const rootAdmin = fullAdmin && user.isRoot === true;
  const fallbackName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.employeeId ||
    "EMS User";

  // Shares its cache with the profile pages, so a new photo shows up here right away.
  const myProfile = useQuery({
    queryKey: ["my-profile"],
    queryFn: () =>
      apiRequest<{
        profile: {
          profileImageUrl?: string | null;
          firstNameEn?: string;
          lastNameEn?: string | null;
        };
      }>("/me/profile"),
    enabled: Boolean(user.employeeRecordId),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const name =
    [myProfile.data?.profile.firstNameEn, myProfile.data?.profile.lastNameEn]
      .filter(Boolean)
      .join(" ") || fallbackName;
  const photoUrl = myProfile.data?.profile?.profileImageUrl ?? null;

  const links: NavDef[] = [
    {
      to: "/",
      label: "Overview",
      icon: Icons.dashboard,
      end: true,
    },
    {
      to: "/profile",
      label: "Profile",
      icon: Icons.profile,
    },
    ...(admin
      ? [
          {
            to: "/employees",
            label: "Employees",
            icon: Icons.employees,
          },
          {
            to: "/departments",
            label: "Departments",
            icon: Icons.departments,
          },
          {
            to: "/data-tools",
            label: "Import & export",
            icon: Icons.data,
          },
        ]
      : []),
    {
      to: "/leave",
      label: "Leave",
      icon: Icons.leave,
    },
    {
      to: "/change-requests",
      label: "Requests",
      icon: Icons.requests,
    },
    {
      to: "/account",
      label: demo ? "Session settings" : "Account settings",
      icon: Icons.account,
    },
  ];
  if (!fullAdmin) {
    const index = links.findIndex((link) => link.to === "/departments");
    if (index >= 0) links.splice(index, 1);
  }
  if (admin)
    links.push(
      {
        to: "/my-leave",
        label: "My leave",
        icon: Icons.leave,
      },
      // Full-access administrators edit their own record directly.
      ...(fullAdmin
        ? []
        : [
            {
              to: "/my-requests",
              label: "My change requests",
              icon: Icons.requests,
            },
          ]),
    );
  const tabPaths = [
    "/",
    admin ? "/employees" : "/profile",
    "/change-requests",
    "/leave",
  ];
  const tabs = tabPaths.flatMap((path) =>
    links.filter((link) => link.to === path),
  );
  const overflow = links.filter((link) => !tabPaths.includes(link.to));
  const isActive = (link: NavDef) =>
    link.end
      ? location.pathname === link.to
      : location.pathname === link.to ||
        location.pathname.startsWith(`${link.to}/`);
  const moreActive = overflow.some(isActive);

  useEffect(() => {
    if (!moreOpen) return;
    const menu = menuRef.current;
    const trigger = moreButtonRef.current;
    const desktop = window.matchMedia("(min-width: 48rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMoreOpen(false);
    };
    menu?.showModal();
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      menu?.close();
      desktop.removeEventListener("change", closeOnDesktop);
      trigger?.focus();
    };
  }, [moreOpen]);

  const userBlock = (
    <div className="ems-user">
      <UserAvatar imageUrl={photoUrl} name={name} />
      <span className="ems-user__text">
        <strong>{name}</strong>
        <span>{tr(roleLabel(user))}</span>
      </span>
    </div>
  );

  return (
    <div className="ems-shell">
      <a className="ems-skip" href="#main">
        {tr("Skip to content")}
      </a>

      <aside className="ems-side">
        <Link className="ems-brand" to="/">
          <BrandBlock />
        </Link>
        <div>
          <nav className="ems-side__nav" aria-label={tr("Main navigation")}>
            {[...tabs, ...overflow].map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className="ems-link"
              >
                {link.icon}
                <span className="ems-link__label">{tr(link.label)}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      <div className="ems-main">
        <header className="ems-top">
          <div className="ems-top__lead">
            <Link to="/" aria-label={tr("Overview")}>
              <BrandMark />
            </Link>
            <div className="ems-crumb">
              <strong>{tr(pageLabel(location.pathname, admin, demo))}</strong>
            </div>
          </div>
          <div className="ems-top__right">
            <LanguageSwitcher />
            {userBlock}
            <button className="ems-btn ems-signout" onClick={onLogout}>
              {Icons.logout}
              {tr("Sign out")}
            </button>
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="ems-content"
          key={location.pathname}
        >
          <Routes>
            <Route path="/my-leave" element={<LeavePage admin={false} />} />
            <Route
              path="/my-requests"
              element={
                fullAdmin ? (
                  <Navigate to="/profile" replace />
                ) : (
                  <ChangeRequestsPage admin={false} />
                )
              }
            />
            <Route path="/account" element={demoSettings ?? <AccountPage />} />
            <Route path="/" element={<Dashboard user={user} />} />
            <Route
              path="/employees"
              element={
                admin ? (
                  <EmployeeDirectory />
                ) : (
                  <Navigate to="/profile" replace />
                )
              }
            />
            <Route
              path="/employees/new"
              element={
                admin ? (
                  <EmployeeCreatePage />
                ) : (
                  <Navigate to="/profile" replace />
                )
              }
            />
            <Route
              path="/employees/:employeeId"
              element={
                admin ? (
                  <EmployeeDetailPage
                    fullAdmin={fullAdmin}
                    rootAdmin={rootAdmin}
                    employeeRecordId={user.employeeRecordId}
                  />
                ) : (
                  <Navigate to="/profile" replace />
                )
              }
            />
            <Route
              path="/profile"
              element={
                fullAdmin ? (
                  <EmployeeDetailPage
                    fullAdmin
                    rootAdmin={rootAdmin}
                    ownProfile
                    employeeRecordId={user.employeeRecordId}
                  />
                ) : (
                  <SelfServiceProfile />
                )
              }
            />
            <Route
              path="/change-requests"
              element={<ChangeRequestsPage admin={admin} />}
            />
            <Route
              path="/leave"
              element={<LeavePage admin={admin} fullAdmin={fullAdmin} />}
            />
            <Route
              path="/data-tools"
              element={
                admin ? (
                  <DataToolsPage admin={admin} fullAdmin={fullAdmin} />
                ) : (
                  <Navigate to="/" replace />
                )
              }
            />
            <Route
              path="/departments"
              element={
                fullAdmin ? <DepartmentsPage /> : <Navigate to="/" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <nav className="ems-tabs" aria-label={tr("Main navigation")}>
        {tabs.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className="ems-link"
          >
            {link.icon}
            <span className="ems-link__label">{tr(link.label)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="ems-link"
          data-active={moreActive || moreOpen}
          ref={moreButtonRef}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          {Icons.more}
          <span className="ems-link__label">{tr("More")}</span>
        </button>
      </nav>

      {moreOpen && (
        <dialog
          ref={menuRef}
          className="ems-sheet"
          aria-label={tr("Menu")}
          onCancel={(event) => {
            event.preventDefault();
            setMoreOpen(false);
          }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.target === event.currentTarget &&
              (event.clientY < bounds.top ||
                event.clientX < bounds.left ||
                event.clientX > bounds.right)
            )
              setMoreOpen(false);
          }}
        >
          <div className="ems-sheet__head">
            <div className="ems-user">
              <UserAvatar imageUrl={photoUrl} name={name} />
              <span>
                <strong>{name}</strong>
                <br />
                <small>{tr(roleLabel(user))}</small>
              </span>
            </div>
            <button
              autoFocus
              type="button"
              className="ems-sheet__close"
              onClick={() => setMoreOpen(false)}
              aria-label={tr("Close")}
            >
              {Icons.close}
            </button>
          </div>
          <nav className="ems-sheet__list" aria-label={tr("Menu")}>
            {overflow.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className="ems-row"
                onClick={() => setMoreOpen(false)}
              >
                {link.icon}
                {tr(link.label)}
              </NavLink>
            ))}
            <button
              type="button"
              className="ems-row ems-row--danger"
              onClick={() => {
                setMoreOpen(false);
                onLogout();
              }}
            >
              {Icons.logout}
              {tr("Sign out")}
            </button>
          </nav>
        </dialog>
      )}
    </div>
  );
}

export default function AppWorkspace(props: Props) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Workspace {...props} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
