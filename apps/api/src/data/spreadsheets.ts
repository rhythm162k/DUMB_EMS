import { writeXlsxBytes, type Sheet } from "./workbook.js";
export * from "./workbook.js";

export async function writeXlsx(sheets: Sheet[]): Promise<Buffer> {
  return Buffer.from(await writeXlsxBytes(sheets));
}
