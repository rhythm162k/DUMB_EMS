import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { validateImport } from "../src/data/records.js";
const id = "00000000-0000-4000-8000-000000000001";
const version = new Date("2026-01-01T00:00:00.000Z");
function database(existing = false) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM employees"))
        return {
          rows: existing ? [{ id, updated_at: version }] : [],
          rowCount: existing ? 1 : 0,
        };
      if (sql.includes("FROM departments"))
        return {
          rows: params[0] === id ? [{ id }] : [],
          rowCount: params[0] === id ? 1 : 0,
        };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
}
const row = {
  rowType: "PROFILE",
  action: "CREATE",
  officialEmployeeId: "000125",
  firstNameEn: "  Demo  ",
  departmentId: id,
  gender: "FEMALE",
  bloodGroup: "B+",
};
describe("Import validation", () => {
  it("normalizes validated data before committing and preserves string IDs", async () => {
    const [r] = await validateImport(database(), [row]);
    expect(r?.errors).toEqual([]);
    expect(r?.payload?.firstNameEn).toBe("Demo");
    expect(r?.payload?.officialEmployeeId).toBe("000125");
  });
  it("rejects unknown fields and duplicate targets", async () => {
    const r = await validateImport(database(), [
      { ...row, role: "ADMIN" },
      row,
    ]);
    expect(r.every((x) => !x.valid)).toBe(true);
    expect(r[0]?.errors.join()).toContain("Unknown column");
    expect(r[1]?.errors.join()).toContain("Duplicate");
  });
  it("does not overwrite an existing employee on CREATE", async () => {
    expect((await validateImport(database(true), [row]))[0]?.valid).toBe(false);
  });
  it("requires the exported version for UPDATE", async () => {
    const [r] = await validateImport(database(true), [
      {
        rowType: "PROFILE",
        action: "UPDATE",
        officialEmployeeId: "000125",
        designation: "New",
      },
    ]);
    expect(r?.errors.join()).toContain("expectedUpdatedAt");
  });
  it("rejects stale updates and accepts a matching version", async () => {
    const update = {
      rowType: "PROFILE",
      action: "UPDATE",
      officialEmployeeId: "000125",
      designation: "New",
      expectedUpdatedAt: version.toISOString(),
    };
    expect((await validateImport(database(true), [update]))[0]?.valid).toBe(
      true,
    );
    expect(
      (
        await validateImport(database(true), [
          { ...update, expectedUpdatedAt: "old" },
        ])
      )[0]?.valid,
    ).toBe(false);
  });
  it("preserves masked data and interprets explicit clear only for optional fields", async () => {
    const [r] = await validateImport(database(true), [
      {
        rowType: "PROFILE",
        action: "UPDATE",
        officialEmployeeId: "000125",
        expectedUpdatedAt: version.toISOString(),
        nationalId: "[MASKED]",
        phone: "[CLEAR]",
      },
    ]);
    expect(r?.valid).toBe(true);
    expect(r?.payload).not.toHaveProperty("nationalId");
    expect(r?.payload?.phone).toBeNull();
  });
  it("rejects malformed UUIDs without sending them to UUID database columns", async () => {
    const [r] = await validateImport(database(true), [
      {
        rowType: "qualifications",
        action: "UPDATE",
        officialEmployeeId: "000125",
        recordId: "-".repeat(36),
        expectedUpdatedAt: version.toISOString(),
        institution: "Demo",
        degree: "Degree",
      },
    ]);
    expect(r?.valid).toBe(false);
    expect(r?.errors.join()).toContain("recordId");
  });
  it("requires selected parent creates for new child rows", async () => {
    const child = {
      rowType: "qualifications",
      action: "CREATE",
      officialEmployeeId: "000125",
      institution: "Demo",
      degree: "Degree",
    };
    expect((await validateImport(database(), [child]))[0]?.valid).toBe(false);
    expect(
      (await validateImport(database(), [row, child])).every((r) => r.valid),
    ).toBe(true);
  });
  it("decodes safe CSV phone prefixes before validation", async () => {
    const [r] = await validateImport(database(), [
      { ...row, phone: "'+880100000000" },
    ]);
    expect(r?.valid).toBe(true);
    expect(r?.payload?.phone).toBe("+880100000000");
  });
});
