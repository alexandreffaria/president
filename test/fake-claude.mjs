#!/usr/bin/env node
/**
 * A stand-in for the `claude` command in tests: the real one is never run. It answers like
 * `claude -p --output-format stream-json --verbose`, and:
 *
 * - logs each call ({ args, stdin, cwd, path: its PATH }) to $FAKE_CLAUDE_DIR/calls.jsonl;
 * - like Claude Code, keeps a transcript per session in
 *   $CLAUDE_CONFIG_DIR/projects/<folder>/<session>.jsonl (empty: only its existence counts),
 *   and refuses `--resume` of a session without one ("No conversation found ...");
 * - answers with the next entry of $FAKE_CLAUDE_DIR/script.json when there is one
 *   ({ lines?: object[], text?: string, structured?: object, stderr?: string, exit?: number,
 *   delayMs?: number, pauseMs?: number, gate?: string, lateTranscript?: boolean,
 *   grandchild?: boolean, exitEarly?: boolean, leaveBehind?: true | "attached" }),
 *   otherwise
 *   with "Echo: "
 *   and the last line of its standard input. `structured` is the `--json-schema` answer,
 *   given as the result's `structured_output` the way Claude Code reports structured output;
 *   `pauseMs` waits after the first stream line; `gate` waits, before answering, until a file of
 *   that name exists in $FAKE_CLAUDE_DIR (the test creates it); `lateTranscript` writes a new session's
 *   transcript only at the end of the run, as Claude Code may; `grandchild` starts a process
 *   that holds the run's output open for a minute, its pid in $FAKE_CLAUDE_DIR/grandchild.pid, and with
 *   `exitEarly` the stand-in then exits at once, leaving it running; `leaveBehind` starts one,
 *   detached (not with "attached"), after answering, and leaves it running.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = process.env.FAKE_CLAUDE_DIR;
const claudeDir = process.env.CLAUDE_CONFIG_DIR;
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;

appendFileSync(
  join(dir, "calls.jsonl"),
  `${JSON.stringify({ args, stdin, cwd: process.cwd(), path: process.env.PATH })}\n`,
);

const folder = join(claudeDir, "projects", process.cwd().replace(/[^A-Za-z0-9]/g, "-"));
const transcript = (id) => join(folder, `${id}.jsonl`);
const resume = flag("--resume");
const start = flag("--session-id");
if (resume && !existsSync(transcript(resume))) {
  process.stderr.write(`No conversation found with session ID: ${resume}\n`);
  process.exit(1);
}
const session = resume ?? start ?? "00000000-0000-4000-8000-000000000000";
const writeTranscript = () => {
  if (start && !args.includes("--no-session-persistence")) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(transcript(start), "");
  }
};

let step = {};
const scriptFile = join(dir, "script.json");
if (existsSync(scriptFile)) {
  const script = JSON.parse(readFileSync(scriptFile, "utf8"));
  const counter = join(dir, "counter");
  const n = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
  writeFileSync(counter, String(n + 1));
  step = script[n] ?? {};
}

if (!step.lateTranscript) writeTranscript();

const out = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);
/**
 * A process of its own that keeps the run's output open for a minute, the way a tool Claude
 * Code started would. Detached, it is out of reach of the run's stop: in a session of its own
 * on Linux and, on Windows, out of the job that ends Node's children when Node exits.
 */
const startGrandchild = (detached) => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: ["ignore", "inherit", "inherit"],
    detached,
    windowsHide: true,
  });
  writeFileSync(join(dir, "grandchild.pid"), String(child.pid));
};
if (step.grandchild) {
  startGrandchild(Boolean(step.exitEarly));
  // And the stand-in ends at once, leaving it running.
  if (step.exitEarly) process.exit(0);
}
if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
if (step.gate) {
  while (!existsSync(join(dir, step.gate))) await new Promise((resolve) => setTimeout(resolve, 10));
}
if (step.stderr) process.stderr.write(step.stderr);
const lastLine = stdin.trim().split("\n").at(-1);
const text = step.text ?? `Echo: ${lastLine}`;
const lines = step.lines ?? [
  { type: "system", subtype: "init", session_id: session },
  {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", name: "Read", input: { file_path: join(process.cwd(), "README.md") } },
      ],
    },
  },
  { type: "assistant", message: { content: [{ type: "text", text }] } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: session,
    ...(step.structured !== undefined ? { structured_output: step.structured } : {}),
  },
];
for (const [i, line] of lines.entries()) {
  out(line);
  if (i === 0 && step.pauseMs) await new Promise((resolve) => setTimeout(resolve, step.pauseMs));
}
if (step.lateTranscript) writeTranscript();
if (step.leaveBehind) startGrandchild(step.leaveBehind !== "attached");
process.exit(step.exit ?? 0);
