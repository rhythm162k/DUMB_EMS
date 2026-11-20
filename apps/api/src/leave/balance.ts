import { employeeScopeSql } from "../auth/scope.js";
import { pool } from "../config/database.js";

export function summarizeDayOff(workedDays: number, takenDays: number) {
  const earnedDays = Math.floor(workedDays / 11);
  const balanceDays = earnedDays - takenDays;
  return {
    workedDays,
    earnedDays,
    takenDays,
    balanceDays,
    advanceDays: Math.max(0, -balanceDays),
    progressDays: workedDays % 11,
    workdaysUntilNext: 11 - (workedDays % 11),
  };
}

// Dates and weekday boundaries belong to Bangladesh, independent of the host timezone.
// Recompute from canonical records so corrections, cancellations and joining-date edits
// cannot leave a stored balance out of sync. Future leave is shown separately.
export async function dayOffBalances(
  employeeId: string | null,
  search: string,
  page: number,
  pageSize: number,
  scope: string | null = null,
) {
  const result = await pool.query<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    joiningDate: string | null;
    asOf: string;
    workedDays: number;
    takenDays: number;
    scheduledDays: number;
  }>(
    `WITH selected AS (
       SELECT id, official_employee_id, first_name_en, last_name_en, joining_date
       FROM employees e
       WHERE ($1::uuid IS NULL OR id = $1) AND ${employeeScopeSql("e", "$5")}
         AND ($2 = '' OR strpos(lower(concat_ws(' ', official_employee_id, first_name_en, last_name_en)), lower($2)) > 0)
       ORDER BY official_employee_id, id LIMIT $3 OFFSET $4
     ), clock AS (SELECT (NOW() AT TIME ZONE 'Asia/Dhaka')::date AS today)
     SELECT e.id AS "employeeId", e.official_employee_id AS "employeeCode",
       concat_ws(' ', e.first_name_en, e.last_name_en) AS "employeeName",
       to_char(e.joining_date, 'YYYY-MM-DD') AS "joiningDate",
       to_char(clock.today, 'YYYY-MM-DD') AS "asOf",
       counts.worked::int AS "workedDays", counts.taken::int AS "takenDays",
       scheduled.days::int AS "scheduledDays"
     FROM selected e CROSS JOIN clock
     CROSS JOIN LATERAL (
       SELECT count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM leave_records l WHERE l.employee_id=e.id
           AND l.cancelled_at IS NULL AND d.day::date BETWEEN l.start_date AND l.end_date
       )) AS worked,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM leave_records l WHERE l.employee_id=e.id
           AND l.cancelled_at IS NULL AND d.day::date BETWEEN l.start_date AND l.end_date
       )) AS taken
       FROM generate_series(e.joining_date::timestamp, clock.today::timestamp, interval '1 day') d(day)
       WHERE extract(isodow FROM d.day) NOT IN (5,6)
         AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.holiday_date=d.day::date)
     ) counts
     CROSS JOIN LATERAL (
       SELECT count(DISTINCT d.day::date) AS days FROM leave_records l
       CROSS JOIN LATERAL generate_series(
         greatest(l.start_date, clock.today+1, e.joining_date)::timestamp,
         l.end_date::timestamp, interval '1 day'
       ) d(day)
       WHERE l.employee_id=e.id AND l.cancelled_at IS NULL AND e.joining_date IS NOT NULL
         AND extract(isodow FROM d.day) NOT IN (5,6)
         AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.holiday_date=d.day::date)
     ) scheduled
     ORDER BY e.official_employee_id, e.id`,
    [employeeId, search, pageSize + 1, (page - 1) * pageSize, scope],
  );
  return {
    items: result.rows.slice(0, pageSize).map((row) => ({
      ...row,
      ...(row.joiningDate
        ? summarizeDayOff(row.workedDays, row.takenDays)
        : {
            workedDays: null,
            earnedDays: null,
            takenDays: null,
            balanceDays: null,
            advanceDays: null,
            progressDays: null,
            workdaysUntilNext: null,
          }),
    })),
    pagination: { page, pageSize, hasMore: result.rows.length > pageSize },
  };
}
