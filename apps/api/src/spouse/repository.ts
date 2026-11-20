import { pool } from "../config/database.js";

export type SpouseRow = {
  id: string;
  spouse_name: string;
  spouse_occupation: string | null;
  spouse_date_of_birth: string | null;
  spouse_national_id: string | null;
  created_at: Date;
  updated_at: Date;
};

// DATE columns are formatted in SQL so the pg driver cannot shift them by the server timezone.
export const SPOUSE_SELECT = `
  id, spouse_name, spouse_occupation,
  to_char(spouse_date_of_birth, 'YYYY-MM-DD') AS spouse_date_of_birth,
  spouse_national_id, created_at, updated_at`;

export function toSpouseJson(row: SpouseRow) {
  return {
    id: row.id,
    spouseName: row.spouse_name,
    spouseOccupation: row.spouse_occupation,
    spouseDateOfBirth: row.spouse_date_of_birth,
    spouseNationalId: row.spouse_national_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// At most one spouse record per employee (the table has a UNIQUE employee_id). Returns null if none.
export async function getSpouse(employeeId: string) {
  const result = await pool.query<SpouseRow>(
    `SELECT ${SPOUSE_SELECT} FROM employee_spouse WHERE employee_id = $1`,
    [employeeId],
  );
  const row = result.rows[0];
  return row ? toSpouseJson(row) : null;
}
