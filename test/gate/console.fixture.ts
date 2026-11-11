import { it } from "vitest";
import { expectConsole } from "../setup.ts";

it("logs a React warning", () => {
  console.error('Warning: Each child in a list should have a unique "key" prop.');
});

it("logs a console.warn", () => {
  console.warn("careful");
});

it("expects the error it logs", () => {
  expectConsole("error", /boom/);
  console.error("president UI error:", new Error("boom"));
});

it("expects an error that never comes", () => {
  expectConsole("error", /boom/);
});

it("expects one error but logs another", () => {
  expectConsole("error", /boom/);
  console.error("boom");
  console.error("something else");
});

it("stays quiet", () => {});
