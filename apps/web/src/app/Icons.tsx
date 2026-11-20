/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";

/* 24px line icons drawn with currentColor (same style as the CRM nav icons). */
function Svg({
  children,
  className = "ems-icon",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  search: (
    <Svg>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4 4" />
    </Svg>
  ),
  dashboard: (
    <Svg>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Svg>
  ),
  employees: (
    <Svg>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16 4.9a3.25 3.25 0 0 1 0 6.2M18 14.8c1.8.7 3 2.4 3 5.2" />
    </Svg>
  ),
  profile: (
    <Svg>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </Svg>
  ),
  leave: (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
      <path d="m9.5 15 1.8 1.8 3.4-3.6" />
    </Svg>
  ),
  requests: (
    <Svg>
      <path d="M4 13.5 6.2 5.6A1.5 1.5 0 0 1 7.6 4.5h8.8a1.5 1.5 0 0 1 1.4 1.1L20 13.5" />
      <path d="M4 13.5V18a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 18v-4.5h-4.5l-1 2h-5l-1-2H4Z" />
    </Svg>
  ),
  departments: (
    <Svg>
      <path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V20" />
      <path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V20" />
      <path d="M3 20h18M8 8h3M8 12h3M8 16h3" />
    </Svg>
  ),
  data: (
    <Svg>
      <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
    </Svg>
  ),
  account: (
    <Svg>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  ),
  more: (
    <Svg>
      <circle cx="5.5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18.5" cy="12" r="1.2" />
    </Svg>
  ),
  plus: (
    <Svg>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  arrow: (
    <Svg>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  refresh: (
    <Svg>
      <path d="M20 11a8 8 0 0 0-14.5-4M4 4v3.5h3.5" />
      <path d="M4 13a8 8 0 0 0 14.5 4M20 20v-3.5h-3.5" />
    </Svg>
  ),
  logout: (
    <Svg>
      <path d="M14 4.5h4A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </Svg>
  ),
  close: (
    <Svg>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  pulse: (
    <Svg>
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </Svg>
  ),
  anchor: (
    <Svg className="ems-icon ems-icon--brand">
      <circle cx="12" cy="5.5" r="2" />
      <path d="M12 7.5V20M7.5 11.5h9" />
      <path d="M4.5 14c.4 3.4 3.4 6 7.5 6s7.1-2.6 7.5-6" />
      <path d="m4.5 14 1.3-2.2M19.5 14l-1.3-2.2" />
    </Svg>
  ),
};
