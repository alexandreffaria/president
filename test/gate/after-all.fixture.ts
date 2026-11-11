import { afterAll, it } from "vitest";

afterAll(() => {
  process.emitWarning("warning in afterAll");
});

it("passes", () => {});
