import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  DEPARTMENT_ID_PROBLEM,
  INVALID_ENTRY,
  INVALID_ROW,
  friendlyRowErrors,
  importRowMessages,
} from "../apps/api/src/data/import-messages.js";
import { publicMessages } from "../apps/api/src/http/public-errors.js";
import {
  readCsv,
  readXlsx,
  writeXlsx,
} from "../apps/api/src/data/spreadsheets.js";
import { safeError } from "../apps/web/src/lib/public-errors.js";
import { plainBn } from "../apps/web/src/i18n/plain-bn.js";

describe("Friendly import messages", () => {
  it("explains a wrong department ID in plain words", () => {
    for (const raw of [
      "Choose an active department ID.",
      "departmentId: Select a valid department.",
      "departmentId: Invalid UUID",
    ])
      expect(friendlyRowErrors([raw]).errors).toEqual([DEPARTMENT_ID_PROBLEM]);
    expect(DEPARTMENT_ID_PROBLEM).toMatch(/^Invalid data entry/);
  });
  it("never passes raw validation text to the browser", () => {
    const result = friendlyRowErrors([
      "email: Invalid email SELECT * FROM users",
      "SELECT password_hash FROM users",
      "Unknown column: <script>",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/SELECT|script|password_hash/);
    expect(result.errors).toContain(INVALID_ROW);
    expect(result.columns).toEqual(["email"]);
  });
  it("keeps the browser, API and Bangla copy aligned", () => {
    for (const message of [...importRowMessages, INVALID_ENTRY])
      expect(plainBn[message]).toBeTruthy();
    for (const message of publicMessages) {
      expect(safeError(new Error(message))).toBe(message);
      expect(plainBn[message]).toBeTruthy();
    }
  });
});

describe("Excel files saved by Excel", () => {
  it("accepts printer settings, styled empty cells and date serial numbers", async () => {
    const zip = await JSZip.loadAsync(
      await writeXlsx([
        {
          name: "PROFILE",
          columns: ["officialEmployeeId", "joiningDate"],
          rows: [{ officialEmployeeId: "010021", joiningDate: "" }],
        },
      ]),
    );
    zip.file("xl/printerSettings/printerSettings1.bin", "printer");
    const name = "xl/worksheets/sheet1.xml";
    const xml = await zip.file(name)!.async("string");
    zip.file(
      name,
      xml
        // Excel keeps empty, styled cells after the last column.
        .replaceAll("</row>", '<c r="D1" s="1"/></row>')
        // A date typed into Excel is stored as a number of days.
        .replace(
          '<c r="B2" t="inlineStr"><is><t xml:space="preserve"></t></is></c>',
          '<c r="B2"><v>46343</v></c>',
        ),
    );
    expect(
      await readXlsx(await zip.generateAsync({ type: "nodebuffer" })),
    ).toEqual([{ officialEmployeeId: "010021", joiningDate: "2026-11-17" }]);
  });
  it("still refuses macros", async () => {
    const zip = await JSZip.loadAsync(
      await writeXlsx([{ name: "PROFILE", columns: ["id"], rows: [] }]),
    );
    zip.file("xl/vbaProject.bin", "bad");
    await expect(
      readXlsx(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow(/Unsupported/);
  });
  it("ignores the guide sheets of the template", async () => {
    const bytes = await writeXlsx([
      { name: "Import rules", columns: ["Field"], rows: [{ Field: "x" }] },
      {
        name: "Departments",
        columns: ["Department"],
        rows: [{ Department: "y" }],
      },
      { name: "PROFILE", columns: ["id"], rows: [{ id: "1" }] },
    ]);
    expect(await readXlsx(bytes)).toEqual([{ id: "1" }]);
  });
  it("ignores trailing empty columns in CSV files", () => {
    expect(readCsv("a,b,\r\n1,2,\r\n")).toEqual([{ a: "1", b: "2" }]);
  });
});
