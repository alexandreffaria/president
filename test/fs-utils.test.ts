import { describe, expect, it } from "vitest";
import { retryTransientWindows } from "../src/server/fs-utils.ts";

function failing(code: string, times: number) {
  let calls = 0;
  const op = async () => {
    calls++;
    if (calls <= times) throw Object.assign(new Error(code), { code });
    return "done";
  };
  return { op, calls: () => calls };
}

describe("retryTransientWindows", () => {
  it("retries EPERM, EBUSY and EACCES on Windows until the operation succeeds", async () => {
    for (const code of ["EPERM", "EBUSY", "EACCES"]) {
      const f = failing(code, 3);
      await expect(retryTransientWindows(f.op, "win32")).resolves.toBe("done");
      expect(f.calls()).toBe(4);
    }
  });

  it("gives up after a while, with the error as it was", async () => {
    const f = failing("EPERM", Infinity);
    await expect(retryTransientWindows(f.op, "win32")).rejects.toMatchObject({
      code: "EPERM",
    });
    expect(f.calls()).toBe(11);
  });

  it("doesn't retry elsewhere, or other errors", async () => {
    const elsewhere = failing("EPERM", 1);
    await expect(retryTransientWindows(elsewhere.op, "linux")).rejects.toMatchObject({
      code: "EPERM",
    });
    expect(elsewhere.calls()).toBe(1);
    const other = failing("ENOENT", 1);
    await expect(retryTransientWindows(other.op, "win32")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(other.calls()).toBe(1);
  });
});
