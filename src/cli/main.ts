/**
 * The `president` command line. Used by humans to run the hub and by agents to register
 * projects, validate the cards they wrote and find cards that need their attention.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "../server/errors.ts";

/** The sample project that `president demo` copies. */
export const DEMO_SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "examples",
  "demo-project",
);

/** The card format spec, so agents in other projects can find it. */
export const CARD_FORMAT_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "card-format.md",
);

const HELP = `president: decision cards for humans, written by agents

Usage:
  president add <path> [--name <name>] [--create]
      Register a project folder with the hub. --create makes <path>/decisions/ if missing.
  president list [--json]
      Show registered projects.
  president remove <name-or-path>
      Unregister a project (its files are not touched).
  president validate [path]
      Check every card in <path>/decisions/ (default: current folder), or one card file.
      Exit code 1 if any is broken.
  president pending [path] [--json]
      What an agent should act on: resolved cards not yet applied, cards where the human
      rejected all options, and new notes from the human. Each card ends with the \`done\`
      command to run once you have acted on it.
  president applied <card-file> --token <token>
      Mark a resolved card as applied (sets applied_at) after updating the project's docs.
  president seen <card-file> --token <token>
      Mark the human's feedback on a card as read (sets seen_at), after acting on it.
      Both take the token \`pending\` printed, and refuse if the human changed the card since.
  president demo [path] [--name <name>]
      Copy the sample project into <path> (default: a new temporary folder) and register the
      copy, to try president without touching any of your files.
  president serve
      Start the hub web app (needs \`npm run build\` first for the UI).

Environment:
  PRESIDENT_PORT     port for \`serve\` (default 4747)
  XDG_CONFIG_HOME    the registry lives in $XDG_CONFIG_HOME/president/projects.json

Card format: ${CARD_FORMAT_DOC}
`;

export type Output = { log: (line: string) => void; error: (line: string) => void };

/**
 * The commands are loaded only when one runs, so \`president help\` (and a typo) doesn't
 * pay for the YAML parser, zod and the server code.
 */
const commands = () => import("./commands.ts");

export async function run(argv: string[], out: Output = console): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "add":
        return await (await commands()).add(rest, out);
      case "list":
      case "ls":
        return await (await commands()).list(rest, out);
      case "remove":
      case "rm":
        return await (await commands()).remove(rest, out);
      case "validate":
        return await (await commands()).validate(rest, out);
      case "pending":
        return await (await commands()).pending(rest, out);
      case "applied":
        return await (await commands()).applied(rest, out);
      case "seen":
        return await (await commands()).seen(rest, out);
      case "demo":
        return await (await commands()).demo(rest, out);
      case "serve":
      case "start":
        return await (await commands()).serve(out);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        out.log(HELP);
        return 0;
      default:
        out.error(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UserError || isArgError(error)) {
      out.error(`president: ${(error as Error).message}`);
      for (const line of (error as UserError).details ?? []) out.error(`  - ${line}`);
      return 1;
    }
    throw error;
  }
}

function isArgError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}
