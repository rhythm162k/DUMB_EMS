import JSZip from "jszip";
import { xml2js, type Element } from "xml-js";

export const MAX_ROWS = 1000;
const MAX_XML = 8 * 1024 * 1024;
export type DataRow = Record<string, string>;
// Optional look of a sheet; sheets without it are written with the plain defaults.
export type SheetFormat = {
  widths?: number[];
  wrap?: boolean;
  textColumns?: string[];
};
export type Sheet = {
  name: string;
  columns: string[];
  rows: DataRow[];
  format?: SheetFormat;
};
const escapeXml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function safeCell(value: string): string {
  return /^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
}
export function writeCsv(columns: string[], rows: DataRow[]): string {
  const cell = (v: string) => `"${safeCell(v).replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      columns.map(cell).join(","),
      ...rows.map((r) => columns.map((c) => cell(r[c] ?? "")).join(",")),
    ].join("\r\n") +
    "\r\n"
  );
}
export function readCsv(input: string): DataRow[] {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const finishCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS + 1)
      throw new Error("Maximum 1000 rows per file.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed) throw new Error("Invalid CSV quoting.");
      quoted = true;
    } else if (c === ",") finishCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finishRow();
    } else {
      if (closed) throw new Error("Unexpected text after a quoted CSV field.");
      cell += c;
    }
    if (cell.length > 10000 || row.length > 100)
      throw new Error("Spreadsheet cell or column limit exceeded.");
  }
  if (quoted) throw new Error("Unclosed quoted CSV field.");
  if (cell || row.length || closed) finishRow();
  return tableRows(rows);
}
// Spreadsheet programs keep empty, styled cells after the last real column.
const trimTrailingBlanks = (row: string[]): string[] => {
  let end = row.length;
  while (end > 0 && (row[end - 1] ?? "").trim() === "") end--;
  return row.slice(0, end);
};
function tableRows(input: string[][]): DataRow[] {
  const table = input.map(trimTrailingBlanks);
  const headers = table.shift()?.map((v) => v.trim()) ?? [];
  if (
    !headers.length ||
    headers.some((v) => !v) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("Missing or duplicate column headers.");
  if (
    headers.some((v) => ["__proto__", "constructor", "prototype"].includes(v))
  )
    throw new Error("Invalid column header.");
  return table
    .filter((r) => r.some((v) => v !== ""))
    .map((r, i) => {
      if (r.length > headers.length)
        throw new Error(`Row ${i + 2} has extra columns.`);
      return Object.fromEntries(headers.map((h, j) => [h, r[j] ?? ""]));
    });
}
const children = (node: Element, name: string) =>
  (node.elements ?? []).filter(
    (e) => e.type === "element" && e.name?.split(":").pop() === name,
  );
const child = (node: Element, name: string) => children(node, name)[0] ?? {};
const textOf = (node: Element): string =>
  (node.elements ?? [])
    .map((e) => (e.type === "text" ? String(e.text ?? "") : textOf(e)))
    .join("");
// Shared strings may hold rich-text runs and phonetic hints; keep only the real text.
const sharedStringText = (si: Element): string =>
  (si.elements ?? [])
    .map((e) => {
      const name = e.name?.split(":").pop();
      if (name === "t") return textOf(e);
      if (name === "r") return children(e, "t").map(textOf).join("");
      return "";
    })
    .join("");
// Excel stores dates as day counts from 1899-12-30.
function excelSerialToIso(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000)
    .toISOString()
    .slice(0, 10);
}
const DATE_HEADER = /date/i;
// Sheets that explain the template and hold no data to import.
const GUIDE_SHEETS = new Set(["Instructions", "Import rules", "Departments"]);
function parseXml(text: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("XML declarations/entities are not allowed.");
  return xml2js(text, { compact: false }) as Element;
}
function columnNumber(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0];
  if (!letters) throw new Error("Invalid spreadsheet cell reference.");
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  if (n > 100) throw new Error("Maximum 100 columns.");
  return n - 1;
}
// Reads the data sheets only; the guide sheets of the template are skipped.
export async function readXlsx(bytes: Uint8Array): Promise<DataRow[]> {
  const sheets = await readWorkbook(bytes, true);
  return sheets.flatMap((sheet) => sheet.rows);
}
// Reads every sheet, guide sheets included (used by tests).
export async function readXlsxSheets(
  bytes: Uint8Array,
): Promise<{ name: string; rows: DataRow[] }[]> {
  return readWorkbook(bytes, false);
}
async function readWorkbook(
  bytes: Uint8Array,
  skipGuides: boolean,
): Promise<{ name: string; rows: DataRow[] }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  // Excel adds harmless printer settings (.bin) to normal files, so only code,
  // external links and embedded objects are refused.
  if (
    names.length > 300 ||
    names.some(
      (n) =>
        /vbaProject|externalLinks|activeX|embeddings|oleObject/i.test(n) ||
        (/\.bin$/i.test(n) && !/^xl\/printerSettings\//i.test(n)),
    )
  )
    throw new Error("Unsupported workbook content. Use a plain XLSX template.");
  let total = 0;
  const read = async (name: string) => {
    const f = zip.file(name);
    if (!f) throw new Error(`Missing workbook part: ${name}`);
    // JSZip exposes this portable (browser and Node) stream on entries.
    const entry = f as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    };
    const stream = entry.internalStream("uint8array");
    const decoder = new TextDecoder();
    let text = "";
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: Uint8Array) => {
        total += chunk.byteLength;
        if (total > MAX_XML) {
          stream.pause();
          reject(new Error("Expanded workbook is too large."));
          return;
        }
        text += decoder.decode(chunk, { stream: true });
      });
      stream.on("end", resolve);
      stream.on("error", reject);
      stream.resume();
    });
    return parseXml(text + decoder.decode());
  };
  const workbook = child(await read("xl/workbook.xml"), "workbook");
  const rels = children(
    child(await read("xl/_rels/workbook.xml.rels"), "Relationships"),
    "Relationship",
  );
  if (rels.some((r) => r.attributes?.TargetMode === "External"))
    throw new Error("External workbook relationships are not allowed.");
  let strings: string[] = [];
  if (zip.file("xl/sharedStrings.xml"))
    strings = children(
      child(await read("xl/sharedStrings.xml"), "sst"),
      "si",
    ).map(sharedStringText);
  const result: { name: string; rows: DataRow[] }[] = [];
  let totalRows = 0;
  for (const sheet of children(child(workbook, "sheets"), "sheet")) {
    const sheetName = String(sheet.attributes?.name ?? "");
    if (skipGuides && GUIDE_SHEETS.has(sheetName)) continue;
    const relId = Object.entries(sheet.attributes ?? {}).find(
      ([key]) => key === "r:id" || key.endsWith(":id"),
    )?.[1];
    const rel = rels.find((r) => r.attributes?.Id === relId);
    const target = String(rel?.attributes?.Target ?? "");
    const name = target.startsWith("/xl/") ? target.slice(1) : `xl/${target}`;
    if (!/^xl\/worksheets\/[\w.-]+\.xml$/.test(name))
      throw new Error("Unsupported sheet location.");
    const xml = child(await read(name), "worksheet");
    const table: string[][] = [];
    for (const row of children(child(xml, "sheetData"), "row")) {
      if (table.length > MAX_ROWS)
        throw new Error("Maximum 1000 rows per file.");
      const values: string[] = [];
      for (const c of children(row, "c")) {
        if (children(c, "f").length)
          throw new Error(
            "Formulas are not accepted. Paste values before importing.",
          );
        const type = c.attributes?.t;
        const v = textOf(child(c, "v"));
        if (type === "e") throw new Error("Workbook contains an error cell.");
        let value =
          type === "s"
            ? strings[Number(v)]
            : type === "inlineStr"
              ? textOf(child(c, "is"))
              : v;
        if (value === undefined || value.length > 10000)
          throw new Error("Invalid or oversized cell.");
        const index = columnNumber(String(c.attributes?.r ?? ""));
        const header = table[0]?.[index] ?? "";
        const isText = type === "s" || type === "inlineStr" || type === "str";
        // Empty styled cells carry no data, so they are never an error.
        if (value.trim() === "") {
          values[index] = "";
          continue;
        }
        // Templates use text IDs; a number has already lost any leading zeroes.
        if (table.length && header === "officialEmployeeId" && !isText)
          throw new Error(
            "Store employee IDs as text to preserve leading zeroes.",
          );
        // Excel turns typed dates into serial numbers or ISO date cells.
        if (table.length && DATE_HEADER.test(header) && !isText) {
          if (type === "d") value = value.slice(0, 10);
          else value = excelSerialToIso(value) ?? value;
        }
        values[index] = value;
      }
      table.push(
        Array.from({ length: values.length }, (_, i) => values[i] ?? ""),
      );
    }
    const rows = table.length ? tableRows(table) : [];
    totalRows += rows.length;
    if (totalRows > MAX_ROWS) throw new Error("Maximum 1000 rows per file.");
    result.push({ name: sheetName, rows });
  }
  return result;
}
// Cell styles used by formatted sheets: 0 = default, 1 = text, 2 = wrapped text.
const STYLE_TEXT = 1;
const STYLE_WRAP = 2;
const STYLES_XML =
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";
export async function writeXlsxBytes(
  sheets: Sheet[],
): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  const xml = (s: string) =>
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + s;
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const relNs =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const hasStyles = sheets.some((s) => s.format);
  const sheetParts = sheets.map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  );
  const stylesPart = hasStyles
    ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    : "";
  zip.file(
    "[Content_Types].xml",
    xml(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetParts.join("")}${stylesPart}</Types>`,
    ),
  );
  zip.file(
    "_rels/.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
  );
  zip.file(
    "xl/workbook.xml",
    xml(
      `<workbook xmlns="${ns}" xmlns:r="${relNs}"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    ),
  );
  const stylesRel = hasStyles
    ? `<Relationship Id="rId${sheets.length + 1}" Type="${relNs}/styles" Target="styles.xml"/>`
    : "";
  zip.file(
    "xl/_rels/workbook.xml.rels",
    xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${relNs}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}${stylesRel}</Relationships>`,
    ),
  );
  if (hasStyles) zip.file("xl/styles.xml", xml(STYLES_XML));
  const col = (n: number): string =>
    n < 26
      ? String.fromCharCode(65 + n)
      : col(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));
  sheets.forEach((s, i) => {
    const text = new Set(s.format?.textColumns ?? []);
    // Style of one column: text columns keep leading zeros, wrapped sheets wrap.
    const styleOf = (c: number): number =>
      text.has(s.columns[c] ?? "")
        ? STYLE_TEXT
        : s.format?.wrap
          ? STYLE_WRAP
          : 0;
    const cols = s.columns
      .map((_, j) => {
        const style = styleOf(j);
        const width = s.format?.widths?.[j] ?? 24;
        return `<col min="${j + 1}" max="${j + 1}" width="${width}" customWidth="1"${style ? ` style="${style}"` : ""}/>`;
      })
      .join("");
    const table = [
      s.columns,
      ...s.rows.map((r) => s.columns.map((c) => r[c] ?? "")),
    ];
    const rows = table
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map((value, c) => {
              const style = r === 0 && s.format?.wrap ? STYLE_WRAP : styleOf(c);
              return `<c r="${col(c)}${r + 1}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
            })
            .join("")}</row>`,
      )
      .join("");
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      xml(
        `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${rows}</sheetData></worksheet>`,
      ),
    );
  });
  return Uint8Array.from(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}
