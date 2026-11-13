/**
 * Card files on disk: loading every card of a project, finding one by id, applying
 * actions to it and undoing the last one.
 *
 * Path safety: cards are only ever addressed by (project name, card id). The project
 * comes from the registry, the id must match CARD_ID_PATTERN, and the file is found by
 * listing the project's decisions/ folder. Symlinked card files are not followed, and a
 * decisions/ folder that resolves outside the project is refused, so no request can reach
 * outside the project.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  afterUndoingDecision,
  applyAction,
  type CardAction,
  type CardActionType,
} from "../core/actions.ts";
import type {
  BrokenCardDto,
  CardDetailDto,
  CardDto,
  ProjectCounts,
  ProjectDto,
} from "../core/api.ts";
import {
  MAX_CARD_BYTES,
  type ParsedCard,
  parseCard,
  parseCardFileName,
  splitFrontmatter,
} from "../core/card-file.ts";
import { updateCardText } from "../core/card-writer.ts";
import {
  CARD_ID_PATTERN,
  cardWarnings,
  formatWarning,
  lineSuffix,
  type RawFrontmatter,
  sameCardId,
} from "../core/schema.ts";
import { UserError } from "./errors.ts";
import { isNotFound, KeyedMutex, writeFileAtomic } from "./fs-utils.ts";
import { decisionsDirOf, type Project } from "./registry.ts";

export interface LoadedCard extends ParsedCard {
  project: string;
  path: string;
  revision: string;
}

/** Something odd about a valid card that an agent should look at. */
export interface CardWarning {
  fileName: string;
  id: string;
  message: string;
}

export interface ProjectCards {
  cards: LoadedCard[];
  broken: BrokenCardDto[];
  warnings: CardWarning[];
  /** Set when the decisions folder itself can't be read. */
  error: string | undefined;
}

/** Files in decisions/ that are not cards. */
export function isIgnoredFile(fileName: string): boolean {
  return (
    fileName.startsWith(".") ||
    fileName.startsWith("_") ||
    !fileName.endsWith(".md") ||
    /^readme\.md$/i.test(fileName)
  );
}

export function revisionOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The project's decisions/ folder, after checking that it really is inside the project
 * (a symlink pointing elsewhere is refused). Returns an error message instead when it isn't
 * usable.
 */
async function decisionsDir(project: Project): Promise<{ dir: string } | { error: string }> {
  const dir = decisionsDirOf(project);
  try {
    const [realProject, realDir] = await Promise.all([realpath(project.path), realpath(dir)]);
    if (!realDir.startsWith(realProject + sep)) {
      return {
        error: `${dir} links to ${realDir}, outside the project; president doesn't follow it. Move the cards into the project.`,
      };
    }
    return { dir };
  } catch (error) {
    if (!isNotFound(error)) return { error: `cannot read ${dir}: ${(error as Error).message}` };
    // A project is its folder: one that moved is a new project to president.
    const folderGone = await lstat(project.path).then(
      () => false,
      () => true,
    );
    return {
      error: folderGone
        ? `the project folder ${project.path} is missing. If it moved, remove this project and add it again from its new place.`
        : `${dir} does not exist`,
    };
  }
}

async function cardFileNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => !isIgnoredFile(n)).sort();
}

export async function loadProjectCards(project: Project): Promise<ProjectCards> {
  const empty = { cards: [], broken: [], warnings: [] };
  const located = await decisionsDir(project);
  if ("error" in located) return { ...empty, error: located.error };
  let names: string[];
  try {
    names = await cardFileNames(located.dir);
  } catch (error) {
    return { ...empty, error: `cannot read ${located.dir}: ${(error as Error).message}` };
  }
  pruneCache(located.dir, names);
  const results = await Promise.all(names.map((name) => loadFile(project, name, true)));
  const { cards, broken } = collect(project, results);
  const warnings = [...cards.flatMap(ownWarnings), ...dependencyWarnings(cards, broken)];
  return { cards, broken, warnings, error: undefined };
}

/** The warnings a card gets on its own (schema.ts), such as more options than keys. */
function ownWarnings(card: LoadedCard): CardWarning[] {
  return cardWarnings(card.frontmatter).map((warning) => ({
    fileName: card.fileName,
    id: card.id,
    message: formatWarning(warning, card.fieldLines),
  }));
}

/** Separates cards from broken files; two files with the same id are both broken. */
function collect(
  project: Project,
  results: (LoadedCard | BrokenCardDto | undefined)[],
): { cards: LoadedCard[]; broken: BrokenCardDto[] } {
  const cards: LoadedCard[] = [];
  const broken: BrokenCardDto[] = [];
  for (const result of results) {
    if (!result) continue;
    if ("errors" in result) broken.push(result);
    else cards.push(result);
  }

  const byId = new Map<string, LoadedCard[]>();
  for (const card of cards) byId.set(card.id, [...(byId.get(card.id) ?? []), card]);
  const unique: LoadedCard[] = [];
  for (const card of cards) {
    const twins = byId.get(card.id) ?? [];
    if (twins.length > 1) {
      const others = twins.filter((t) => t !== card).map((t) => t.fileName);
      broken.push({
        project: project.name,
        fileName: card.fileName,
        id: card.id,
        errors: [
          `id "${card.id}" is also used by ${others.join(", ")}; give each card its own id. If you wrote one of them, give yours (the newer one) a new dated id (the current date plus 4 random characters, see docs/card-format.md): change its id and rename its file to match`,
        ],
      });
    } else {
      unique.push(card);
    }
  }
  broken.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { cards: unique, broken };
}

/** `depends_on` entries that don't name another card of the project. */
function dependencyWarnings(cards: LoadedCard[], broken: BrokenCardDto[]): CardWarning[] {
  const ids = [...cards.map((c) => c.id), ...broken.flatMap((b) => (b.id ? [b.id] : []))];
  const warnings: CardWarning[] = [];
  for (const card of cards) {
    const line = lineSuffix(card.fieldLines.depends_on);
    for (const dep of card.frontmatter.depends_on) {
      if (sameCardId(dep, card.id)) {
        warnings.push({
          fileName: card.fileName,
          id: card.id,
          message: `depends_on lists itself${line}`,
        });
      } else if (!ids.some((id) => sameCardId(dep, id))) {
        warnings.push({
          fileName: card.fileName,
          id: card.id,
          message: `depends_on "${dep}" is not a card in this project${line}`,
        });
      }
    }
  }
  return warnings;
}

/**
 * Parsed cards by path, reused while the file is unchanged. Only used for listings; a
 * single card (and every write) is always read fresh.
 */
const cache = new Map<string, { stamp: string; result: LoadedCard | BrokenCardDto }>();

/**
 * Drops the cached cards of projects that are no longer registered. Listing a project only
 * prunes inside that project, so without this an unregistered project's parsed cards
 * would stay in memory until the server restarts.
 */
export function forgetUnregisteredCards(projects: Project[]): void {
  const dirs = projects.map((project) => decisionsDirOf(project) + sep);
  for (const path of cache.keys()) {
    if (!dirs.some((dir) => path.startsWith(dir))) cache.delete(path);
  }
}

/** The files whose parsed cards are cached (for tests). */
export function cachedCardPaths(): string[] {
  return [...cache.keys()];
}

function pruneCache(dir: string, names: string[]): void {
  const keep = new Set(names.map((name) => join(dir, name)));
  for (const path of cache.keys()) {
    if (path.startsWith(dir + sep) && !keep.has(path)) cache.delete(path);
  }
}

async function loadFile(
  project: Project,
  fileName: string,
  useCache: boolean,
): Promise<LoadedCard | BrokenCardDto | undefined> {
  const path = join(decisionsDirOf(project), fileName);
  const broken = (errors: string[]): BrokenCardDto => ({
    project: project.name,
    fileName,
    id: parseCardFileName(fileName)?.id,
    errors,
  });
  try {
    const info = await lstat(path, { bigint: true });
    if (info.isSymbolicLink()) {
      return broken([
        "this is a symlink; president doesn't follow symlinks. Replace it with the card file itself.",
      ]);
    }
    if (!info.isFile()) return undefined;
    if (info.size > MAX_CARD_BYTES) {
      return broken([
        `the file is ${(info.size + 1023n) / 1024n} kB; cards must be at most ${MAX_CARD_BYTES / 1024} kB`,
      ]);
    }
    const stamp = `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    const cached = cache.get(path);
    if (useCache && cached?.stamp === stamp) {
      return { ...cached.result, project: project.name };
    }

    const text = await readFile(path, "utf8");
    const parsed = parseCard(text, fileName);
    const result: LoadedCard | BrokenCardDto = parsed.ok
      ? { ...parsed.card, project: project.name, path, revision: revisionOf(text) }
      : { project: project.name, ...parsed.problem };
    // Like git's "racily clean" rule: file times are coarse (a few ms), so a file changed in
    // the last couple of seconds could change again without its stamp moving. Only files
    // that have settled are cached; any later write moves ctime past the cached stamp.
    const changedMs = Math.max(
      Number(info.mtimeNs / 1_000_000n),
      Number(info.ctimeNs / 1_000_000n),
    );
    const settled = Date.now() - changedMs > 2000;
    if (settled) cache.set(path, { stamp, result });
    else cache.delete(path);
    return result;
  } catch (error) {
    if (isNotFound(error)) return undefined; // deleted while we were listing
    // One unreadable file must never fail the whole project.
    return broken([`cannot read file: ${(error as Error).message}`]);
  }
}

export type FindCardResult = { ok: true; card: LoadedCard } | { ok: false; broken: BrokenCardDto };

/** Finds one card by id, reading only the files whose name starts with that id. */
export async function findCard(project: Project, id: string): Promise<FindCardResult> {
  if (!CARD_ID_PATTERN.test(id)) throw new UserError(`"${id}" is not a valid card id`);
  const located = await decisionsDir(project);
  if ("error" in located) throw new UserError(located.error, { status: 404 });
  let names: string[];
  try {
    names = await cardFileNames(located.dir);
  } catch (error) {
    throw new UserError(`cannot read ${located.dir}: ${(error as Error).message}`, {
      status: 404,
    });
  }
  const mine = names.filter((name) => parseCardFileName(name)?.id === id);
  const results = await Promise.all(mine.map((name) => loadFile(project, name, false)));
  const { cards, broken } = collect(project, results);
  const card = cards.find((c) => c.id === id);
  if (card) return { ok: true, card };
  const problem = broken.find((b) => b.id === id);
  if (problem) return { ok: false, broken: problem };
  throw new UserError(`no card "${id}" in project "${project.name}"`, { status: 404 });
}

const writeLock = new KeyedMutex();

/** What the last action on each card replaced, so the human can undo it. */
interface UndoEntry {
  before: string;
  /** The revision the action produced; undo only works while the file is still at it. */
  after: string;
  /**
   * The file president wrote (see fileStamp). The revision alone isn't enough: an agent
   * that writes those same bytes back (it applies the decision, then reverts its own edit)
   * has changed the card since, and the undo must be refused.
   */
  stamp: string | undefined;
  action: CardActionType;
  at: number;
}

/** Which file is at `path`, and when it last changed: any write, even of the same bytes, moves it. */
async function fileStamp(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path, { bigint: true });
    return `${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}:${info.size}`;
  } catch {
    return undefined;
  }
}
const undoJournal = new Map<string, UndoEntry>();
const UNDO_TTL_MS = 30 * 60 * 1000;
const UNDO_MAX_ENTRIES = 200;

function remember(path: string, entry: UndoEntry): void {
  undoJournal.delete(path);
  undoJournal.set(path, entry);
  const now = Date.now();
  for (const [key, value] of undoJournal) {
    if (undoJournal.size <= UNDO_MAX_ENTRIES && now - value.at < UNDO_TTL_MS) break;
    undoJournal.delete(key);
  }
}

const conflict = (message: string) => new UserError(message, { status: 409, code: "conflict" });

async function lockedCard(project: Project, id: string): Promise<LoadedCard> {
  const found = await findCard(project, id);
  if (!found.ok) {
    throw new UserError(`card "${id}" is broken and can't be changed until it is fixed`, {
      status: 422,
      details: found.broken.errors,
    });
  }
  return found.card;
}

/**
 * Applies an action to a card and writes it back atomically.
 *
 * `revision` is the revision the caller saw; if the file changed since, nothing is written
 * (409 conflict). Pass `null` only when the caller has not shown the card to anyone (the
 * CLI's `applied` and `seen`, which act on whatever is on disk).
 */
export async function actOnCard(
  project: Project,
  id: string,
  action: CardAction,
  options: { revision: string | null; now?: Date },
): Promise<LoadedCard> {
  return writeLock.run(`${project.path}\0${id}`, async () => {
    const card = await lockedCard(project, id);
    if (options.revision !== null && options.revision !== card.revision) {
      throw conflict("the card changed on disk since you opened it; review it again");
    }
    const result = applyAction(card, action, options.now ?? new Date());
    if (!result.ok) {
      const failure = {
        transition: { status: 409, code: "invalid_transition" },
        stale: { status: 409, code: "stale_token" },
        input: { status: 422, code: "invalid_action" },
      } as const;
      throw new UserError(result.error, failure[result.reason]);
    }
    const original = await readFile(card.path, "utf8");
    if (revisionOf(original) !== card.revision) {
      throw conflict("the card changed on disk while saving; try again");
    }
    let text: string;
    try {
      text = updateCardText(original, result.raw);
    } catch (error) {
      // An exotic YAML layout the writer can't update safely: say so instead of a 500.
      throw new UserError(
        `president can't update ${card.fileName} safely: ${(error as Error).message}. Ask an agent to simplify its frontmatter (for example, remove YAML anchors and aliases).`,
        { status: 422, code: "unsupported_layout" },
      );
    }
    const written = await writeChecked(project, card, text);
    remember(card.path, {
      before: original,
      after: written.revision,
      stamp: await fileStamp(card.path),
      action: action.type,
      at: Date.now(),
    });
    return written;
  });
}

/**
 * Puts a card back exactly as it was before the last action taken through this server
 * (byte for byte: no feedback entry, nothing lost). The one exception is a decision: an
 * agent may already have been shown it and acted on it, so its undo also adds an `undo`
 * feedback entry with the decision in `previous_resolution`, and `preside pending` tells
 * the agent to revert that work. `revision` is the revision that action
 * returned; if anything wrote the card since (an agent applied it, another tab acted, an
 * agent wrote the same bytes back), the undo is refused with a 409. Writes are told apart
 * by the file's identity and change time, not only by its content (see UndoEntry.stamp).
 */
export async function undoLastAction(
  project: Project,
  id: string,
  revision: string,
  /**
   * Called with the action about to be undone; throwing refuses the undo. A "neither" whose
   * new-options run already started is refused this way (20261112dfik `refuse-undo`): starting
   * the run writes nothing to the card, so the journal alone can't tell. `card` is the card
   * as the action left it.
   */
  check?: (action: CardActionType, card: LoadedCard) => void,
): Promise<LoadedCard> {
  return writeLock.run(`${project.path}\0${id}`, async () => {
    const card = await lockedCard(project, id);
    const entry = undoJournal.get(card.path);
    const ours = entry?.after === revision ? entry : undefined;
    if (card.revision !== revision || (ours && (await fileStamp(card.path)) !== ours.stamp)) {
      throw conflict(changedSince(ours?.action));
    }
    if (!ours || Date.now() - ours.at > UNDO_TTL_MS) {
      throw new UserError(
        "there is nothing to undo on this card any more (president may have restarted)",
        { status: 409, code: "undo_unavailable" },
      );
    }
    check?.(ours.action, card);
    const text = ours.action === "resolve" ? withUndoEntry(card, ours.before) : ours.before;
    const written = await writeChecked(project, card, text);
    undoJournal.delete(card.path);
    return written;
  });
}

/**
 * Writes new options the hub's new-options run returned (#0007) with `preside update`'s
 * checks: never on a decided card, only while the card is exactly as the run read it
 * (`read`: any write since refuses it, like update's revision check, so an agent's or Sync's
 * edit made during the run is never reverted), and only if the result passes the card checks.
 * `raw` is the new frontmatter and `body` the new body. A refusal is a UserError whose message
 * says why, in words for the human.
 */
export async function rewriteCard(
  project: Project,
  id: string,
  read: LoadedCard,
  next: { raw: RawFrontmatter; body: string },
): Promise<LoadedCard> {
  return writeLock.run(`${project.path}\0${id}`, async () => {
    const card = await lockedCard(project, id);
    if (card.frontmatter.status === "resolved") {
      throw conflict("you decided the card meanwhile");
    }
    // Any write since the run read the card: a note, an undo, an agent's update, Sync.
    if (card.revision !== read.revision) {
      throw conflict("the card changed while the agent was writing them");
    }
    const original = await readFile(card.path, "utf8");
    if (revisionOf(original) !== card.revision) {
      throw conflict("the card changed while saving");
    }
    let text: string;
    try {
      text = updateCardText(original, next.raw);
    } catch (error) {
      throw new UserError(
        `president can't update ${card.fileName} safely: ${(error as Error).message}`,
        { status: 422, code: "unsupported_layout" },
      );
    }
    const split = splitFrontmatter(text);
    if (!split) throw new Error("the card lost its frontmatter");
    text = text.slice(0, text.length - split.body.length) + next.body;
    const parsed = parseCard(text, card.fileName);
    if (!parsed.ok) {
      throw new UserError(
        `the agent's options didn't pass the card checks (${parsed.problem.errors.join("; ")})`,
        { status: 422, code: "invalid_card" },
      );
    }
    return writeChecked(project, card, text);
  });
}

/**
 * `before` (the card before its decision) plus the `undo` feedback entry that tells agents
 * the decision in `decided` was taken back. Written with the card writer, like an action.
 */
function withUndoEntry(decided: LoadedCard, before: string): string {
  const restored = parseCard(before, decided.fileName);
  const result = restored.ok
    ? afterUndoingDecision(restored.card, decided, new Date())
    : { ok: false as const, error: restored.problem.errors.join("; ") };
  try {
    if (!result.ok) throw new Error(result.error);
    return updateCardText(before, result.raw);
  } catch (error) {
    throw new UserError(
      `president can't undo the decision on ${decided.fileName} safely: ${(error as Error).message}. Reopen it instead.`,
      { status: 422, code: "unsupported_layout" },
    );
  }
}

/**
 * Why an undo was refused, and what the human can do instead, for the action they tried to
 * undo (undefined: not known, president may have restarted). Neutral about who changed the
 * card: it may have been the human, in another tab.
 */
function changedSince(action: CardActionType | undefined): string {
  switch (action) {
    case "note":
    case "chat":
    case "neither":
      return "the card changed since (an agent may already have read your note), so it can't be taken back; add another note to correct it";
    case "defer":
      return "the card changed since you deferred it, so it can't be undone; reopen it if needed";
    case "reopen":
      return "the card changed since you reopened it (an agent may already be acting on it), so it can't be undone; decide it again if needed";
    case "unwithdraw":
      return "the card changed since you put it back in the queue (an agent may already have read your note), so it can't be undone; decide it if it no longer matters";
    default:
      return "the card changed after this action, so it can't be undone; review it and reopen it if needed";
  }
}

async function writeChecked(project: Project, card: LoadedCard, text: string): Promise<LoadedCard> {
  // Parse before writing: a write must never turn a valid card into a broken one.
  const reparsed = parseCard(text, card.fileName);
  if (!reparsed.ok) {
    throw new Error(`refusing to write an invalid card: ${reparsed.problem.errors.join("; ")}`);
  }
  await writeFileAtomic(card.path, text);
  return { ...reparsed.card, project: project.name, path: card.path, revision: revisionOf(text) };
}

export function toCardDto(card: LoadedCard): CardDto {
  return {
    project: card.project,
    id: card.id,
    fileName: card.fileName,
    revision: card.revision,
    frontmatter: card.frontmatter,
  };
}

export function toCardDetailDto(
  card: LoadedCard,
  writtenByPresident = false,
  changedBySync = false,
): CardDetailDto {
  return {
    ...toCardDto(card),
    body: card.body,
    sections: card.sections,
    path: card.path,
    writtenByPresident,
    changedBySync,
  };
}

export function countCards(cards: ProjectCards): ProjectCounts {
  const counts: ProjectCounts = { open: 0, deferred: 0, resolved: 0, broken: cards.broken.length };
  for (const card of cards.cards) counts[card.frontmatter.status] += 1;
  return counts;
}

export function projectDto(project: Project, cards: ProjectCards): ProjectDto {
  return {
    name: project.name,
    path: project.path,
    decisionsDir: decisionsDirOf(project),
    error: cards.error,
    counts: countCards(cards),
  };
}

export async function describeProject(project: Project): Promise<ProjectDto> {
  return projectDto(project, await loadProjectCards(project));
}
