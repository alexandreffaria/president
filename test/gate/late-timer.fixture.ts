import { it } from "vitest";

it("starts a timer that warns after the test is over", () => {
  setTimeout(() => process.emitWarning("late warning"), 30);
});
