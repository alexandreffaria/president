/**
 * What the hub keeps about card conversations on this machine, in president's state folder
 * (`$XDG_STATE_HOME/president/`, by default `~/.local/state/president/`). None of it is in a
 * project, none of it travels with Sync, and all of it is keyed by project name and card id
 * ("Four per-machine stores, one folder" in docs/roadmap.md):
 *
 *   sessions.json             { "<project>/<id>": SessionEntry }: the card's Claude Code
 *                             session id (#0021), whether the conversation has messages no
 *                             saved summary covers (#0024), and which pick the human revealed
 *                             in it (2026111272fu)
 *   chats/<project>/<id>.jsonl  the hub's copy of the messages it showed (#0018), one
 *                             ChatMessageDto per line
 *   missing.json              { "<project>/<id>": when the card or its project was first found
 *                             gone } (202611114wet: deleted 30 days after that)
 *
 * Only the hub writes here, one process per machine, so a lock inside the process is enough.
 * Folders are created private (0700): the copies can quote project files.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ChatMessageDto } from "../../core/api.ts";
import { CARD_ID_PATTERN } from "../../core/schema.ts";
import { isNotFound, KeyedMutex, writeFileAtomic } from "../fs-utils.ts";
import { PROJECT_NAME_PATTERN } from "../registry.ts";

export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_STATE_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
  return join(base, "president");
}

export interface SessionEntry {
  /** The Claude Code session id this machine resumes (`claude -p --resume <id>`). */
  session?: string;
  /** Messages were exchanged since the last saved summary (#0024's reminder). */
  unsummarized?: boolean;
  /**
   * How many of the hub copy's messages the last saved summary covers: the next summary is
   * about the ones after them.
   */
  summarized?: number;
  /**
   * Which recommendation the human revealed in this conversation (a hash of it, see
   * pickHash): the chat is free about that pick, and neutral again about a new one
   * (2026111272fu).
   */
  revealed?: string;
}

export interface CardKey {
  project: string;
  id: string;
}

type Table<T> = Record<string, T>;

const keyOf = ({ project, id }: CardKey) => `${project}/${id}`;

function parseKey(key: string): CardKey | undefined {
  const [project, id, ...rest] = key.split("/");
  if (rest.length > 0 || !project || !id) return undefined;
  if (!PROJECT_NAME_PATTERN.test(project) || !CARD_ID_PATTERN.test(id)) return undefined;
  return { project, id };
}

export class ChatStore {
  readonly dir: string;
  readonly #lock = new KeyedMutex();

  constructor(stateDir: string = defaultStateDir()) {
    this.dir = stateDir;
  }

  get #chatsDir() {
    return join(this.dir, "chats");
  }

  #copyPath(key: CardKey): string {
    // Both parts are checked patterns (no "/" or ".."), so the path stays in chats/.
    if (!parseKey(keyOf(key))) throw new Error(`not a card key: ${keyOf(key)}`);
    return join(this.#chatsDir, key.project, `${key.id}.jsonl`);
  }

  async entry(key: CardKey): Promise<SessionEntry | undefined> {
    return (await this.#readTable<SessionEntry>("sessions.json"))[keyOf(key)];
  }

  /** Changes a card's entry; returning undefined removes it. */
  async updateEntry(
    key: CardKey,
    change: (entry: SessionEntry | undefined) => SessionEntry | undefined,
  ): Promise<SessionEntry | undefined> {
    return this.#lock.run("sessions.json", async () => {
      const table = await this.#readTable<SessionEntry>("sessions.json");
      const next = change(table[keyOf(key)]);
      if (next) table[keyOf(key)] = next;
      else delete table[keyOf(key)];
      await this.#writeTable("sessions.json", table);
      return next;
    });
  }

  async messages(key: CardKey): Promise<ChatMessageDto[]> {
    let text: string;
    try {
      text = await readFile(this.#copyPath(key), "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const messages: ChatMessageDto[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line) as Partial<ChatMessageDto>;
        if (
          typeof m.at === "string" &&
          typeof m.text === "string" &&
          (m.from === "you" || m.from === "agent" || m.from === "hub")
        ) {
          messages.push({ at: m.at, from: m.from, text: m.text });
        }
      } catch {
        // A line cut short by a crash: skip it, keep the rest.
      }
    }
    return messages;
  }

  async append(key: CardKey, message: ChatMessageDto): Promise<void> {
    const path = this.#copyPath(key);
    await this.#lock.run(path, async () => {
      await mkdir(join(this.#chatsDir, key.project), { recursive: true, mode: 0o700 });
      await appendFile(path, `${JSON.stringify(message)}\n`, { mode: 0o600 });
    });
  }

  /** Every card this machine keeps anything for (a copy, a session entry, a missing date). */
  async keys(): Promise<CardKey[]> {
    const found = new Map<string, CardKey>();
    const add = (key: CardKey | undefined) => {
      if (key) found.set(keyOf(key), key);
    };
    for (const file of ["sessions.json", "missing.json"]) {
      for (const key of Object.keys(await this.#readTable(file))) add(parseKey(key));
    }
    for (const project of await readdirOrEmpty(this.#chatsDir)) {
      for (const name of await readdirOrEmpty(join(this.#chatsDir, project))) {
        if (name.endsWith(".jsonl")) add(parseKey(`${project}/${name.slice(0, -".jsonl".length)}`));
      }
    }
    return [...found.values()];
  }

  /** When the card or its project was first found missing (ISO time), if it is. */
  async missingSince(key: CardKey): Promise<string | undefined> {
    return (await this.#readTable<string>("missing.json"))[keyOf(key)];
  }

  async setMissingSince(key: CardKey, at: string | undefined): Promise<void> {
    await this.#lock.run("missing.json", async () => {
      const table = await this.#readTable<string>("missing.json");
      if (table[keyOf(key)] === at) return;
      if (at === undefined) delete table[keyOf(key)];
      else table[keyOf(key)] = at;
      await this.#writeTable("missing.json", table);
    });
  }

  /** Deletes everything kept for the card: its copy, its session entry and its missing date. */
  async forget(key: CardKey): Promise<void> {
    await rm(this.#copyPath(key), { force: true });
    await this.updateEntry(key, () => undefined);
    await this.setMissingSince(key, undefined);
  }

  async #readTable<T>(file: string): Promise<Table<T>> {
    const path = join(this.dir, file);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if (isNotFound(error)) return {};
      throw error;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Table<T>;
    } catch {
      // handled below
    }
    // Not something president wrote (edited by hand, a disk error): keep it aside for a
    // look, and start over rather than refuse every conversation.
    await rename(path, `${path}.broken-${Date.now()}`).catch(() => {});
    return {};
  }

  async #writeTable(file: string, table: Table<unknown>): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(join(this.dir, file), `${JSON.stringify(table, null, 2)}\n`);
  }
}

async function readdirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}
