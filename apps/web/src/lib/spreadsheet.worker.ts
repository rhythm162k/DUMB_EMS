/// <reference lib="webworker" />
import {
  readCsv,
  readXlsx,
  writeCsv,
  writeXlsxBytes,
  type DataRow,
  type Sheet,
} from "../../../api/src/data/workbook";

type Workbook = { columns: string[]; rows: DataRow[] } | { sheets: Sheet[] };
export type SpreadsheetJob =
  { kind: "read"; file: File } | { kind: "write"; workbook: Workbook };
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.addEventListener(
  "message",
  async (event: MessageEvent<SpreadsheetJob>) => {
    try {
      const job = event.data;
      if (job.kind === "read") {
        const file = job.file;
        const rows = file.name.toLowerCase().endsWith(".xlsx")
          ? await readXlsx(new Uint8Array(await file.arrayBuffer()))
          : readCsv(await file.text());
        if (rows.length > 12)
          throw new Error("The demo accepts up to 12 rows per import.");
        worker.postMessage({ value: rows });
      } else {
        const workbook = job.workbook;
        const blob =
          "sheets" in workbook
            ? new Blob([await writeXlsxBytes(workbook.sheets)], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              })
            : new Blob([writeCsv(workbook.columns, workbook.rows)], {
                type: "text/csv;charset=UTF-8",
              });
        worker.postMessage({ value: blob });
      }
    } catch (error) {
      worker.postMessage({
        error:
          error instanceof Error
            ? error.message
            : "This file could not be opened. Please choose a supported file and try again.",
      });
    }
  },
);
