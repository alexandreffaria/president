/**
 * Runs before every test file. A process warning (such as the `yaml` library's "Keys with
 * collection values will be stringified") fails the test that caused it, so code that
 * should keep stderr quiet can't start writing to it unnoticed.
 */
import { afterEach, expect } from "vitest";

const warnings: string[] = [];
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: never[]) => {
  warnings.push(typeof warning === "string" ? warning : warning.message);
  return emitWarning(warning, ...rest);
}) as typeof process.emitWarning;

afterEach(() => {
  expect(warnings.splice(0), "process warnings during the test").toEqual([]);
});
