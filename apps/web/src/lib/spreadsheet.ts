import type { SpreadsheetJob } from "./spreadsheet.worker";

export function runSpreadsheet<T>(job: SpreadsheetJob): Promise<T> {
  const worker = new Worker(
    new URL("./spreadsheet.worker.ts", import.meta.url),
    { type: "module" },
  );
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "This file could not be opened. Please choose a supported file and try again.",
        ),
      );
    }, 15_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = ({
      data,
    }: MessageEvent<{ value: T; error?: string }>) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.value);
    };
    worker.onerror = () => {
      cleanup();
      reject(
        new Error(
          "This file could not be opened. Please choose a supported file and try again.",
        ),
      );
    };
    worker.postMessage(job);
  });
}
