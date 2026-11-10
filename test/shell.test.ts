import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { shellQuote } from "../src/cli/shell.ts";

describe("shellQuote", () => {
  it("leaves plain paths and tokens as they are", () => {
    expect(shellQuote("/home/sam/app/decisions/0002-api-errors.md")).toBe(
      "/home/sam/app/decisions/0002-api-errors.md",
    );
    expect(shellQuote("2-0k3j5h2g9fd")).toBe("2-0k3j5h2g9fd");
  });

  it("gives back each value as one word in sh", async () => {
    const values = [
      "/Users/sam/My Projects/app",
      "it's",
      "''",
      '$HOME `id` $(id) ; & | > < * ? ~ { } [ ] ! # \\ " \t\nnext line',
      "",
      "-n",
    ];
    const script = `printf '%s\\0' ${values.map(shellQuote).join(" ")}`;
    const { stdout } = await promisify(execFile)("sh", ["-c", script]);
    expect(stdout.split("\0").slice(0, -1)).toEqual(values);
  });
});
