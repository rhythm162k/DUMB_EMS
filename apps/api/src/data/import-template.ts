import {
  templateCsvDefinition,
  type TemplateDepartment,
} from "./template-data.js";
import { writeCsv } from "./spreadsheets.js";
export * from "./template-data.js";

export function templateCsv(departments: TemplateDepartment[]) {
  const { columns, rows } = templateCsvDefinition(departments);
  return writeCsv(columns, rows);
}
