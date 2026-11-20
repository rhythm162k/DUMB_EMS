import { safeError } from "../../lib/public-errors";
import { tr, currentLanguage } from "../../i18n/language";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../../lib/api";
import { Icons } from "../../app/Icons";
import { StatCard } from "../../app/StatCard";
import MyProfileCard from "./MyProfileCard";

type Stats = { requests: number; leaves: number; onLeave: boolean };

function todayLabel() {
  return new Date().toLocaleDateString(
    currentLanguage() === "bn" ? "bn-BD" : "en-GB",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );
}

export default function EmployeeDashboard() {
  const stats = useQuery({
    queryKey: ["overview-stats", "EMPLOYEE"],
    queryFn: () => apiRequest<Stats>("/overview/stats"),
  });
  return (
    <section className="workspace-page dash employee-dashboard">
      <header className="dash-header">
        <div>
          <h1>{tr("My overview")}</h1>
          <p>{todayLabel()}</p>
        </div>
      </header>

      <div className="me-layout">
        <MyProfileCard />

        {stats.isPending ? (
          <div
            className="dash-skel dash-skel--card"
            role="status"
            aria-label={tr("Loading requests and leave…")}
          />
        ) : stats.isError ? (
          <div className="dash-error" role="alert">
            <p>{tr(safeError(stats.error))}</p>
            <button className="ems-btn" onClick={() => void stats.refetch()}>
              {Icons.refresh}
              {tr("Retry summary")}
            </button>
          </div>
        ) : (
          <div className="me-side">
            <StatCard
              to="/change-requests"
              tone={stats.data.requests > 0 ? "amber" : "green"}
              icon={Icons.requests}
              label={tr("My pending requests")}
              value={stats.data.requests}
              note={tr("Requests awaiting review")}
            />
            <StatCard
              to="/leave"
              tone="green"
              icon={Icons.leave}
              label={tr("My leave")}
              value={stats.data.leaves}
              note={tr(
                stats.data.onLeave
                  ? "Currently on leave"
                  : "Not currently on leave",
              )}
            />
          </div>
        )}
      </div>
    </section>
  );
}
