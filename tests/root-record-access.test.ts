import { describe, expect, it } from "vitest";
import { isReadOnlyRootRecord } from "../apps/web/src/features/employees/record-access.js";

describe("Root administrator record access in the web app", () => {
  it("lets the root administrator edit their own record and photo", () => {
    expect(
      isReadOnlyRootRecord({
        recordIsRoot: true,
        rootAdmin: true,
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("never shows the signed-in user's own record as read-only", () => {
    expect(
      isReadOnlyRootRecord({
        recordIsRoot: true,
        rootAdmin: false,
        isSelf: true,
      }),
    ).toBe(false);
  });

  it("keeps the root record view-only for other administrators", () => {
    expect(
      isReadOnlyRootRecord({
        recordIsRoot: true,
        rootAdmin: false,
        isSelf: false,
      }),
    ).toBe(true);
  });

  it("does not restrict ordinary employee records", () => {
    expect(
      isReadOnlyRootRecord({
        recordIsRoot: false,
        rootAdmin: false,
        isSelf: false,
      }),
    ).toBe(false);
    expect(
      isReadOnlyRootRecord({
        recordIsRoot: undefined,
        rootAdmin: false,
        isSelf: false,
      }),
    ).toBe(false);
  });
});
