import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { num } from "../i18n/language";
import { Icons } from "./Icons";

export function StatCard({
  to,
  icon,
  tone,
  label,
  value,
  note,
}: {
  to: string;
  icon: ReactNode;
  tone: "green" | "amber";
  label: string;
  value: number | undefined;
  note: string;
}) {
  return (
    <Link className={`dash-stat dash-stat--${tone}`} to={to}>
      <span className="dash-stat__icon">{icon}</span>
      <span className="dash-stat__label">{label}</span>
      <strong className="dash-stat__value">{num(value)}</strong>
      <span className="dash-stat__note">{note}</span>
      <span className="dash-stat__go" aria-hidden="true">
        {Icons.arrow}
      </span>
    </Link>
  );
}
