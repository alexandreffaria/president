/**
 * One run of a card's Claude Code session: `claude -p` in the card's project folder, with the
 * flags #0004 (`readonly`) fixed, the message on standard input, and the reply read from
 * `--output-format stream-json`.
 *
 * Every run gets exactly these permission flags (docs/archive/roadmap-2026-11.md, "The
 * session: read and research only", says why each one is there; none may be dropped):
 *
 *   --restricted --strict-mcp-config
 *   --tools "Read,Grep,Glob,WebSearch,WebFetch" --allowedTools "WebSearch,WebFetch"
 *   --permission-mode dontAsk --permission-prompts none --max-budget-usd 1
 *
 * The message is never a command-line argument: one starting with `-` would be read as an
 * option, and one after a list flag as a tool name. president doesn't read Claude Code's own
 * transcript files (their format is internal): it checks whether one still exists
 * (transcriptExists), to know whether `--resume` can work, and reads one number from the card
 * author's, its size (contextTokens), to know whether forking it fits the run's cap.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { SESSION_ID_PATTERN } from "../../core/schema.ts";
import { withAbsolutePath } from "../executable.ts";
import { isNotFound } from "../fs-utils.ts";
import { killTree } from "../process-tree.ts";
import { CLAUDE_NOT_FOUND, resolveClaude } from "./claude-command.ts";

/** The tools that exist in the session (#0004): reading and research, nothing else. */
export const SESSION_TOOLS = "Read,Grep,Glob,WebSearch,WebFetch";
/** The tools that run without a prompt; Read, Grep and Glob need no rule under dontAsk. */
export const SESSION_ALLOWED_TOOLS = "WebSearch,WebFetch";
/** The spending cap of one run, in US dollars (#0004). */
export const MAX_BUDGET_USD = "1";
/** A run still going after this long is stopped. */
export const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const KILL_GRACE_MS = 5000;
/** How long after the run exits its output may stay open (a process it left holding it). */
const EXIT_GRACE_MS = 2000;
/** At most this much of a run's output is kept (a reply is far smaller). */
const MAX_OUTPUT = 4 * 1024 * 1024;

export type SessionMode =
  /** Continue the card's session. */
  | { resume: string }
  /** Start the card's session with an id chosen up front (#0021). */
  | { start: string }
  /**
   * Start the card's session, with an id chosen up front, as a fork of the session that wrote
   * the card (its `created_session`): `--resume <fork> --fork-session --session-id <start>`.
   * Claude Code finds `fork` in any of its project folders and leaves it untouched; the fork
   * is kept under the run's cwd.
   */
  | { fork: string; start: string }
  /** A one-off run nobody continues (a summary written from the hub's copy, 20261111paot). */
  | { oneOff: true };

export interface RunRequest {
  /**
   * The `claude` executable: a name, looked for in the absolute PATH folders of `env`
   * (claude-command.ts), or a path.
   */
  bin: string;
  /** The project folder; the session's file tools are confined to it (`--restricted`). */
  cwd: string;
  session: SessionMode;
  /** Written to the run's standard input. */
  message: string;
  /** Instructions added to Claude Code's system prompt (sent on a session's first run). */
  appendSystemPrompt?: string | undefined;
  /**
   * The session is a fork of the card author's, made now or when it started: a run stopped at
   * the spending cap suggests New conversation.
   */
  forked?: boolean | undefined;
  /** A JSON schema for structured output (`--json-schema`). */
  jsonSchema?: string | undefined;
  timeoutMs?: number | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunHandlers {
  /** The session started (its first stream line); Claude Code now has it. */
  onStarted?: () => void;
  /** A text block of the reply. */
  onText?: (text: string) => void;
  /** A tool call, described for the page ("Reading src/http.ts"). */
  onActivity?: (text: string) => void;
}

export interface RunResult {
  ok: boolean;
  /** The reply's text blocks, joined with blank lines (what the page showed). */
  text: string;
  /** Why the run failed, in words for the page. */
  error?: string;
  /** Claude Code started the session (a stream line arrived). */
  started: boolean;
  /** `--resume` didn't find the session (the card's, or the one a fork copies). */
  sessionNotFound: boolean;
  /** The `--json-schema` output, when asked for and given. */
  structured?: unknown;
}

/** The arguments of a run, flags in #0004's order. Throws on a session id that isn't a UUID. */
export function claudeArgs(
  request: Pick<RunRequest, "session" | "appendSystemPrompt" | "jsonSchema">,
): string[] {
  const { session } = request;
  // Every id passed to `--resume` or `--session-id` is a UUID (SESSION_ID_PATTERN), checked
  // again before every run: defence in depth for a hand-edited sessions.json or card.
  const id = (value: string) => {
    if (!SESSION_ID_PATTERN.test(value)) {
      throw new Error(`not a session id: ${JSON.stringify(value)}`);
    }
    return value;
  };
  const sessionArgs =
    "resume" in session
      ? ["--resume", id(session.resume)]
      : "fork" in session
        ? ["--resume", id(session.fork), "--fork-session", "--session-id", id(session.start)]
        : "start" in session
          ? ["--session-id", id(session.start)]
          : ["--no-session-persistence"];
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    ...sessionArgs,
    "--restricted",
    "--strict-mcp-config",
    "--tools",
    SESSION_TOOLS,
    "--allowedTools",
    SESSION_ALLOWED_TOOLS,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--max-budget-usd",
    MAX_BUDGET_USD,
    ...(request.appendSystemPrompt ? ["--append-system-prompt", request.appendSystemPrompt] : []),
    ...(request.jsonSchema ? ["--json-schema", request.jsonSchema] : []),
  ];
}

const SHUTTING_DOWN = "The run was stopped because president is shutting down.";

/** Runs the session once. Never throws; a failure is in the result. */
export function runClaude(request: RunRequest, handlers: RunHandlers = {}): Promise<RunResult> {
  let args: string[];
  try {
    args = claudeArgs(request);
  } catch (error) {
    return Promise.resolve({
      ok: false,
      text: "",
      started: false,
      sessionNotFound: false,
      error: `Couldn't start Claude Code: ${(error as Error).message}`,
    });
  }
  // An abort listener added to a signal that already fired never runs: such a run would
  // never be stopped and, detached, would outlive the hub. Don't start it.
  if (request.signal?.aborted) {
    return Promise.resolve({
      ok: false,
      text: "",
      started: false,
      sessionNotFound: false,
      error: SHUTTING_DOWN,
    });
  }
  const env = request.env ?? process.env;
  const command = resolveClaude(request.bin, env);
  if ("error" in command) {
    return Promise.resolve({
      ok: false,
      text: "",
      started: false,
      sessionNotFound: false,
      error: command.error,
    });
  }
  return new Promise((resolve) => {
    const texts: string[] = [];
    let started = false;
    let stderr = "";
    let size = 0;
    let buffer = "";
    let final: { ok: boolean; error?: string; result?: string; structured?: unknown } | undefined;
    let settled = false;
    let stopped: string | undefined;

    const child = spawn(command.file, [...command.args, ...args], {
      cwd: request.cwd,
      // PATH without the entries that mean the project folder, for what the run looks up itself.
      env: withAbsolutePath(env),
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so the run and anything it started stop together
      // (process-tree.ts; on Windows taskkill /T, which needs no group).
      detached: true,
      shell: false,
      windowsHide: true,
    });

    // Whether the run itself has exited (`close` comes later, once its pipes are closed too).
    let exited = false;
    let exitGrace: NodeJS.Timeout | undefined;
    child.on("exit", () => {
      exited = true;
      // A process the run left behind may hold its output open, which would keep `close`, and
      // the answer, waiting until the run's timeout. Once the run has had time to be read to
      // the end, what is left of it is stopped (its process group; on Windows nothing can be
      // found) and its pipes are closed (killTree), and it ends as it ended: `stopped` stays
      // unset, so its answer counts.
      exitGrace = setTimeout(() => killGroup("SIGTERM"), EXIT_GRACE_MS);
      exitGrace.unref();
    });
    const killGroup = (signal: NodeJS.Signals) => killTree(child, signal, () => exited);
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (why: string) => {
      if (stopped || settled) return;
      stopped = why;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timeoutMs = request.timeoutMs ?? RUN_TIMEOUT_MS;
    const timer = setTimeout(
      () =>
        stop(`The run took longer than ${Math.round(timeoutMs / 60000)} minutes and was stopped.`),
      timeoutMs,
    );
    const onAbort = () => stop(SHUTTING_DOWN);
    request.signal?.addEventListener("abort", onAbort);

    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(exitGrace);
      request.signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: StreamLine;
      try {
        event = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      // A `result` line alone isn't a start: Claude Code also prints one when `--resume`
      // finds no conversation (with "No conversation found" on stderr), and has no session.
      if (!started && event.type !== "result") {
        started = true;
        handlers.onStarted?.();
      }
      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
            texts.push(block.text);
            handlers.onText?.(block.text);
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            handlers.onActivity?.(describeTool(block.name, block.input, request.cwd));
          }
        }
      } else if (event.type === "result") {
        const ok = event.is_error !== true && (event.subtype ?? "success") === "success";
        final = {
          ok,
          ...(typeof event.result === "string" ? { result: event.result } : {}),
          ...(event.structured_output !== undefined ? { structured: event.structured_output } : {}),
          ...(ok ? {} : { error: resultError(event, request.forked === true) }),
        };
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        stop("The run's output was too large and the run was stopped.");
        return;
      }
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        text: "",
        started: false,
        sessionNotFound: false,
        error:
          error.code === "ENOENT"
            ? CLAUDE_NOT_FOUND
            : `Couldn't start Claude Code: ${error.message}`,
      });
    });
    child.on("close", (code) => {
      handleLine(buffer);
      buffer = "";
      // When no text block came, the final result is the reply.
      if (texts.length === 0 && final?.ok && final.result?.trim()) texts.push(final.result);
      const text = texts.join("\n\n").trim();
      const sessionNotFound = !started && /no conversation found/i.test(stderr);
      let error: string | undefined;
      if (stopped) error = stopped;
      else if (final && !final.ok) error = final.error;
      else if (!final) {
        error = sessionNotFound
          ? "Claude Code no longer has this conversation."
          : `Claude Code stopped without answering${code ? ` (exit code ${code})` : ""}${lastLine(stderr)}.`;
      } else if (code) {
        error = `Claude Code exited with code ${code}${lastLine(stderr)}.`;
      }
      finish({
        ok: error === undefined,
        text,
        started,
        sessionNotFound,
        ...(error !== undefined ? { error } : {}),
        ...(final?.structured !== undefined ? { structured: final.structured } : {}),
      });
    });

    child.stdin.on("error", () => {
      // The run ended before reading its message; "close" reports why.
    });
    child.stdin.end(request.message, "utf8");
  });
}

interface StreamLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  errors?: unknown;
  message?: { content?: { type?: string; text?: unknown; name?: unknown; input?: unknown }[] };
}

function resultError(event: StreamLine, forked: boolean): string {
  if (event.subtype === "error_max_budget_usd") {
    return forked
      ? `The run stopped at its spending cap ($${MAX_BUDGET_USD}). This conversation started from the session that wrote the card, which may be too large for the cap now; New conversation starts a smaller one.`
      : `The run stopped at its spending cap ($${MAX_BUDGET_USD}).`;
  }
  if (event.subtype === "error_max_turns") return "The run stopped after too many turns.";
  const detail =
    typeof event.result === "string" && event.result.trim()
      ? event.result.trim()
      : Array.isArray(event.errors) && typeof event.errors[0] === "string"
        ? event.errors[0]
        : undefined;
  return detail ? `The run failed: ${detail}` : `The run failed (${event.subtype ?? "error"}).`;
}

function lastLine(stderr: string): string {
  const line = stderr.trim().split("\n").at(-1)?.trim();
  return line ? `: ${line.slice(0, 300)}` : "";
}

/** A tool call in a few words, paths shown relative to the project. */
export function describeTool(name: string, input: unknown, cwd: string): string {
  const field = (key: string) => {
    const value = (input as Record<string, unknown> | undefined)?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const path = (p: string | undefined) =>
    p && isAbsolute(p) && !relative(cwd, p).startsWith("..") ? relative(cwd, p) || "." : p;
  switch (name) {
    case "Read":
      return `Reading ${path(field("file_path")) ?? "a file"}`;
    case "Grep":
      return `Searching the project for "${field("pattern") ?? ""}"`;
    case "Glob":
      return `Looking for ${field("pattern") ?? "files"}`;
    case "WebSearch":
      return `Searching the web for "${field("query") ?? ""}"`;
    case "WebFetch":
      return `Reading ${field("url") ?? "a web page"}`;
    default:
      return `Using ${name}`;
  }
}

/** Claude Code's folder: `$CLAUDE_CONFIG_DIR`, or `~/.claude`. */
export function defaultClaudeDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR;
  return dir && isAbsolute(dir) ? dir : join(homedir(), ".claude");
}

/**
 * Whether Claude Code still has the session's transcript on this machine
 * (`<claude dir>/projects/<project>/<session>.jsonl`, deleted after `cleanupPeriodDays`).
 * Only the file's existence is checked, in every project folder Claude Code keeps, so the
 * way it names those folders doesn't matter. That is also how `--resume` looks: a session
 * started in another folder (the card's author, in a git worktree that may be gone since)
 * resumes, and forks, from the project folder. A subagent's transcript
 * (`<session>/subagents/agent-<id>.jsonl`) isn't one of these, and `--resume` can't take it.
 */
export async function transcriptExists(claudeDir: string, session: string): Promise<boolean> {
  return (await transcriptPath(claudeDir, session)) !== undefined;
}

/** The session's transcript file (see transcriptExists), or undefined. */
export async function transcriptPath(
  claudeDir: string,
  session: string,
): Promise<string | undefined> {
  if (!SESSION_ID_PATTERN.test(session)) return undefined;
  const projects = join(claudeDir, "projects");
  let folders: string[];
  try {
    folders = await readdir(projects);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
  for (const folder of folders) {
    const path = join(projects, folder, `${session}.jsonl`);
    const found = await stat(path).then(
      (info) => info.isFile(),
      () => false,
    );
    if (found) return path;
  }
  return undefined;
}

/**
 * The most a session may hold for a card's chat to start as a fork of it, in tokens of
 * context. A fork's first run sends all of it, written to the prompt cache at 1.25 times the
 * input price: about $0.44 for 70k tokens at the default model's $5 per million input
 * tokens. That leaves over half of the run's $1 cap (MAX_BUDGET_USD) for the answer and a few
 * tool calls, each of which reads the cached context again at a tenth of the price (about
 * $0.04 a call). The rest is headroom: the limit is checked only when the fork is made, and a
 * fork that grew writes its whole context to the cache again on a run after the cache
 * expired. A real 184k-token fork spent its whole dollar on the cache write and stopped
 * without an answer.
 */
export const MAX_FORK_TOKENS = 70_000;
/**
 * A transcript larger than this isn't read to find its size (contextTokens runs before the
 * human's message is saved): it counts as unreadable, so no fork.
 */
export const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/**
 * How much context the session held at its last answer, in tokens, read from the transcript
 * at `path`: the last real main-thread assistant entry's `message.usage` (input, cache writes,
 * cache reads and output). Subagents' entries (`isSidechain`) don't count, nor do the ones
 * Claude Code writes for a failed API call (network, overload, usage limit, "Prompt is too
 * long"): `model: "<synthetic>"`, every count 0. Undefined when it can't be read: no such
 * entry, a format this doesn't know, or a file over MAX_TRANSCRIPT_BYTES. This is the only
 * thing president reads in a transcript.
 */
export async function contextTokens(path: string): Promise<number | undefined> {
  try {
    if ((await stat(path)).size > MAX_TRANSCRIPT_BYTES) return undefined;
    const lines = (await readFile(path, "utf8")).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line?.includes('"assistant"')) continue;
      let entry: TranscriptEntry;
      try {
        entry = JSON.parse(line) as TranscriptEntry;
      } catch {
        continue;
      }
      if (entry.type !== "assistant" || entry.isSidechain === true) continue;
      if (entry.message?.model === SYNTHETIC_MODEL) continue;
      const usage = entry.message?.usage;
      if (!usage || typeof usage !== "object") continue;
      if (typeof usage.input_tokens !== "number") return undefined;
      const parts = [
        usage.input_tokens,
        usage.cache_creation_input_tokens,
        usage.cache_read_input_tokens,
        usage.output_tokens,
      ];
      const total = parts.reduce<number>(
        (sum, n) => sum + (typeof n === "number" && n > 0 ? n : 0),
        0,
      );
      // No real answer has an empty context (a failed call that isn't marked synthetic).
      if (total > 0) return total;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** The `model` of the entry Claude Code writes for an API call that failed. */
const SYNTHETIC_MODEL = "<synthetic>";

interface TranscriptEntry {
  type?: unknown;
  isSidechain?: unknown;
  message?: { model?: unknown; usage?: Record<string, unknown> };
}
