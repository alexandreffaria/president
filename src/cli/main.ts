/**
 * The `preside` command line (`president`, its old name, is an alias until F2). Used by
 * humans to run the hub and by agents to register projects, validate the cards they wrote and find cards that need their attention.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UserError } from "../server/errors.ts";

/** The sample project that `preside demo` copies. */
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

const HELP = `preside: decision cards for humans, written by agents

Usage:
  preside add <path> [--name <name>] [--create]
      Register a project folder with the hub. --create makes <path>/decisions/ if missing.
      The name defaults to the folder's name, with -2, -3... added if it is taken.
  preside list [--json]
      Show registered projects.
  preside remove <name-or-path>
      Unregister a project (its files are not touched).
  preside validate [path]
      Check every card in <path>/decisions/ (default: current folder), or one card file.
      Exit code 1 if any is broken.
  preside pending [path] [--json]
      What an agent should act on: resolved cards not yet applied, cards where the human
      rejected all options, and new notes from the human. Each card ends with the \`done\`
      command to run once you have acted on it.
  preside applied <card-file> --token <token>
      Mark a resolved card as applied (sets applied_at) after updating the project's docs.
  preside seen <card-file> --token <token>
      Mark the human's feedback on a card as read (sets seen_at), after acting on it.
      Both take the token \`pending\` printed, and refuse if the human changed the card since.
  preside update <card-file> <new-version-file>
      Replace a card with your rewrite of it (new options, recommendation, body), written
      from the card as you read it. Refuses, and changes nothing, if the card is decided or
      if the human added a note or changed the card since: keep status, resolution,
      feedback, seen_at and applied_at as they are. Your file is left for you to remove.
  preside demo [path] [--name <name>]
      Copy the sample project into <path> (default: a new temporary folder) and register the
      copy, to try president without touching any of your files.
  preside serve
      Start the hub web app (needs \`npm run build\` first for the UI).

Environment:
  PRESIDENT_PORT     port for \`serve\` (default 4747)
  XDG_CONFIG_HOME    the registry lives in $XDG_CONFIG_HOME/president/projects/ (one file
                     per project)

Card format: ${CARD_FORMAT_DOC}
`;

export type Output = { log: (line: string) => void; error: (line: string) => void };

/**
 * The commands are loaded only when one runs, so \`preside help\` (and a typo) doesn't
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
      case "update":
        return await (await commands()).update(rest, out);
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
      out.error(`preside: ${(error as Error).message}`);
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
