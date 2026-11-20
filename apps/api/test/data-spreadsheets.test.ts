import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  readCsv,
  readXlsx,
  writeCsv,
  writeXlsx,
  safeCell,
} from "../src/data/spreadsheets.js";

describe("CSV and XLSX data codecs", () => {
  it("round trips Unicode, leading zero IDs, quotes, commas and multiline CSV", () => {
    const rows = [
      { id: "000125", name: 'নাদিয়া, "ডেমো"', note: "line 1\nline 2" },
    ];
    expect(readCsv(writeCsv(["id", "name", "note"], rows))).toEqual(rows);
  });
  it("rejects duplicate or dangerous headers and malformed CSV", () => {
    for (const input of [
      "id,id\n1,2",
      "__proto__,name\n1,2",
      'id,name\n"unclosed',
      'id\n"closed"tail',
      "id\n1,2",
    ])
      expect(() => readCsv(input)).toThrow();
  });
  it("neutralizes formula prefixes including whitespace", () => {
    for (const value of ["=1+1", "+123", "-2", "@sum(A1)", " \t=NOW()"])
      expect(safeCell(value)).toBe("'" + value);
  });
  it("limits CSV rows and cell lengths", () => {
    expect(() => readCsv("id\n" + "1\n".repeat(1001))).toThrow(/1000/);
    expect(() => readCsv("id\n" + "a".repeat(10001))).toThrow(/limit/);
  });
  it("round trips a multi-sheet workbook using literal strings, never formulas", async () => {
    const rows = [{ id: "000125", name: "বাংলা <&>", note: "=SUM(A1)" }];
    const bytes = await writeXlsx([
      { name: "PROFILE", columns: ["id", "name", "note"], rows },
      { name: "training", columns: ["id", "name", "note"], rows: [] },
    ]);
    expect(await readXlsx(bytes)).toEqual(rows);
  });
  it("ignores the template instruction sheet", async () => {
    const bytes = await writeXlsx([
      {
        name: "Instructions",
        columns: ["Instructions"],
        rows: [{ Instructions: "Help" }],
      },
      { name: "PROFILE", columns: ["id"], rows: [] },
    ]);
    expect(await readXlsx(bytes)).toEqual([]);
  });
  it("rejects formula cells even if a cached result exists", async () => {
    const zip = await JSZip.loadAsync(
      await writeXlsx([
        { name: "PROFILE", columns: ["id"], rows: [{ id: "1" }] },
      ]),
    );
    const name = "xl/worksheets/sheet1.xml";
    const xml = await zip.file(name)!.async("string");
    zip.file(
      name,
      xml.replace('<c r="A2" t="inlineStr">', '<c r="A2"><f>1+1</f><v>2</v>'),
    );
    await expect(
      readXlsx(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow(/Formulas/);
  });
  it("rejects macros and external workbook links", async () => {
    const bytes = await writeXlsx([
      { name: "PROFILE", columns: ["id"], rows: [] },
    ]);
    const macro = await JSZip.loadAsync(bytes);
    macro.file("xl/vbaProject.bin", "bad");
    await expect(
      readXlsx(await macro.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow(/Unsupported/);
    const external = await JSZip.loadAsync(bytes);
    const name = "xl/_rels/workbook.xml.rels";
    external.file(
      name,
      (await external.file(name)!.async("string")).replace(
        'Target="worksheets',
        'TargetMode="External" Target="worksheets',
      ),
    );
    await expect(
      readXlsx(await external.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow(/External/);
  });
  it("rejects XML entity declarations", async () => {
    const zip = await JSZip.loadAsync(
      await writeXlsx([{ name: "PROFILE", columns: ["id"], rows: [] }]),
    );
    zip.file("xl/workbook.xml", '<!DOCTYPE x [<!ENTITY a "boom">]><workbook/>');
    await expect(
      readXlsx(await zip.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow(/entities/);
  });
  it("bounds decompression before XML parsing", async () => {
    const zip = await JSZip.loadAsync(
      await writeXlsx([{ name: "PROFILE", columns: ["id"], rows: [] }]),
    );
    zip.file("xl/workbook.xml", " ".repeat(8 * 1024 * 1024 + 1));
    await expect(
      readXlsx(
        await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      ),
    ).rejects.toThrow(/too large/);
  });
});
