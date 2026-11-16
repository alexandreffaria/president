/**
 * Card files on disk: loading every card of a project, finding one by id, applying
 * actions to it and undoing the last one.
 *
 * Checkouts: the hub reads a project's cards from every checkout of it (a HubProject, see
 * checkouts.ts), since a card lives on the branch whose work it unblocks. The same card in
 * several checkouts is one card (see pickCopy), and a write goes to the copy shown. A plain
 * Project (what `preside` passes) is just its own folder.
 *
 * Path safety: cards are only ever addressed by (project name, card id). The project
 * comes from the registry, its other checkouts from git, the id must match CARD_ID_PATTERN,
 * and the file is found by listing a checkout's decisions/ folder. Symlinked card files are
 * not followed, and a decisions/ folder that resolves outside its checkout is refused, so no
 * request can reach outside the project's checkouts.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
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
import type { Checkout, HubProject } from "./checkouts.ts";
import { UserError } from "./errors.ts";
import { isNotFound, KeyedMutex, writeFileAtomic } from "./fs-utils.ts";
import { DECISIONS_DIR, decisionsDirOf, type Project } from "./registry.ts";

export interface LoadedCard extends ParsedCard {
  project: string;
  path: string;
  revision: string;
  /** The branch of the checkout the file is in (null: detached HEAD, or not in git). */
  branch: string | null;
  /** When the file last changed (ms), to choose between differing copies (pickCopy). */
  changedMs: number;
}

/**
 * Where cards are read: a project with its checkouts (a HubProject, the hub), or without
 * them, just its folder (`preside`).
 */
export type CardScope = Project & { checkouts?: HubProject["checkouts"] };

/** The checkouts of `scope`, the registered folder first. */
export function checkoutsIn(scope: CardScope): readonly Checkout[] {
  return scope.checkouts ?? [{ path: scope.path, branch: null }];
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
 * A checkout's decisions/ folder, after checking that it really is inside the checkout
 * (a symlink pointing elsewhere is refused). Returns an error message instead when it isn't
 * usable; `missing` when the checkout is there but has no decisions/ folder (normal in a
 * checkout whose branch has no cards yet).
 */
async function decisionsDir(
  project: Pick<Project, "path">,
): Promise<{ dir: string } | { error: string; missing: boolean }> {
  const dir = decisionsDirOf(project);
  try {
    const [realProject, realDir] = await Promise.all([realpath(project.path), realpath(dir)]);
    if (!realDir.startsWith(realProject + sep)) {
      return {
        error: `${dir} links to ${realDir}, outside the project; president doesn't follow it. Move the cards into the project.`,
        missing: false,
      };
    }
    return { dir };
  } catch (error) {
    if (!isNotFound(error)) {
      return { error: `cannot read ${dir}: ${(error as Error).message}`, missing: false };
    }
    // A project is its folder: one that moved is a new project to president.
    const folderGone = await lstat(project.path).then(
      () => false,
      () => true,
    );
    return {
      error: folderGone
        ? `the project folder ${project.path} is missing. If it moved, remove this project and add it again from its new place.`
        : `${dir} does not exist`,
      missing: !folderGone,
    };
  }
}

async function cardFileNames(dir: string): Promise<string[]> {
  return (await readdir(dir)).filter((n) => !isIgnoredFile(n)).sort();
}

/**
 * Every card of the project, from each of its checkouts. Only the registered folder's
 * problems are the project's `error`: another checkout without a usable decisions/ folder
 * (its branch has no cards, or it links outside) is left out. A registered folder without
 * decisions/ (its branch has none) is no error either while another checkout has one.
 */
export async function loadProjectCards(scope: CardScope): Promise<ProjectCards> {
  const checkouts = checkoutsIn(scope);
  const loaded = await Promise.all(checkouts.map((checkout) => loadCheckout(scope, checkout)));
  const first = loaded[0];
  const elsewhere = loaded.some((result) => !("error" in result));
  const error =
    first && "error" in first && !(first.missing && elsewhere) ? first.error : undefined;
  const cards: LoadedCard[][] = [];
  const brokenIn: { dir: string; broken: BrokenCardDto[] }[] = [];
  checkouts.forEach((checkout, i) => {
    const result = loaded[i];
    if (!result || "error" in result) return;
    cards.push(result.cards);
    brokenIn.push({ dir: decisionsDirOf(checkout), broken: result.broken });
  });
  const { cards: merged, broken: twins } = mergeCopies(cards);
  const shown = new Map(merged.map((card) => [card.id, card]));
  // A copy that reads as a card wins: the same file broken in another checkout isn't listed.
  // A broken file in the shown card's own folder still is, as in a single folder.
  const broken = brokenIn.flatMap(({ dir, broken }) =>
    broken.filter((b) => {
      const card = b.id === undefined ? undefined : shown.get(b.id);
      return !(card && card.fileName === b.fileName && dirname(card.path) !== dir);
    }),
  );
  const shownBroken = uniqueBroken([...broken, ...twins]);
  const warnings = [...merged.flatMap(ownWarnings), ...dependencyWarnings(merged, shownBroken)];
  return { cards: merged, broken: shownBroken, warnings, error };
}

type CheckoutCards = { cards: LoadedCard[]; broken: BrokenCardDto[] };
type CheckoutProblem = { error: string; missing: boolean };

/** The cards in one checkout, those whose id is `onlyId` when given (read fresh then). */
async function loadCheckout(
  project: Pick<Project, "name">,
  checkout: Checkout,
  onlyId?: string,
): Promise<CheckoutCards | CheckoutProblem> {
  const located = await decisionsDir(checkout);
  if ("error" in located) return located;
  let names: string[];
  try {
    names = await cardFileNames(located.dir);
  } catch (error) {
    return { error: `cannot read ${located.dir}: ${(error as Error).message}`, missing: false };
  }
  if (onlyId === undefined) pruneCache(located.dir, names);
  const mine =
    onlyId === undefined ? names : names.filter((n) => parseCardFileName(n)?.id === onlyId);
  const results = await Promise.all(
    mine.map((name) => loadFile(project, checkout, name, onlyId === undefined)),
  );
  return collect(project, results);
}

/**
 * The cards of several checkouts (the registered folder's first), each card once: the copy
 * {@link pickCopy} chooses. Sorted by file name, like one folder's. Two different cards with
 * the same id on two branches (see {@link copiesOfOneCard}) are both broken instead.
 */
function mergeCopies(byCheckout: LoadedCard[][]): { cards: LoadedCard[]; broken: BrokenCardDto[] } {
  if (byCheckout.length === 1) return { cards: byCheckout[0] ?? [], broken: [] };
  const copies = new Map<string, LoadedCard[]>();
  for (const cards of byCheckout) {
    for (const card of cards) copies.set(card.id, [...(copies.get(card.id) ?? []), card]);
  }
  const cards: LoadedCard[] = [];
  const broken: BrokenCardDto[] = [];
  for (const group of copies.values()) {
    const picked = pickOne(group);
    if ("card" in picked) cards.push(picked.card);
    else broken.push(...picked.broken);
  }
  return { cards: cards.sort((a, b) => a.fileName.localeCompare(b.fileName)), broken };
}

/**
 * Whether cards with the same id in several checkouts are copies of one card: the same file
 * name, or the same `created` (an agent may rename a card's file; `created` never changes).
 * Otherwise two agents gave two cards the same id on two branches.
 */
function copiesOfOneCard(copies: LoadedCard[]): boolean {
  const [first, ...rest] = copies;
  return rest.every(
    (copy) =>
      copy.fileName === first?.fileName || copy.frontmatter.created === first?.frontmatter.created,
  );
}

/** {@link pickCopy}, or every copy broken when they are different cards. */
function pickOne(copies: LoadedCard[]): { card: LoadedCard } | { broken: BrokenCardDto[] } {
  if (copiesOfOneCard(copies)) return { card: pickCopy(copies) };
  return {
    broken: copies.map((card) => {
      const others = copies
        .filter((other) => other !== card)
        .map((other) => `${other.fileName} on ${other.branch ?? "another checkout"}`);
      return {
        project: card.project,
        fileName: card.fileName,
        id: card.id,
        branch: card.branch,
        errors: [
          `id "${card.id}" is also used by a different card, ${others.join(", ")}; give each card its own id. If you wrote one of them, give yours (the newer one) a new dated id (the current date plus 4 random characters, see docs/card-format.md): change its id and rename its file to match`,
        ],
      };
    }),
  };
}

/**
 * Which copy of a card in several checkouts the hub shows and writes to (`copies` in
 * checkout order, the registered folder first). Copies with the same content are one card:
 * the first. When they differ (the human answered one, an agent changed another), the one
 * with the latest activity in its frontmatter (a decision, a note, `applied`, a withdrawal)
 * wins, then the copy this hub wrote last (see hubWrote), then the file changed last, then
 * the first. Not `seen_at`: an agent that marks a
 * stale, unanswered copy seen must not make it beat the copy the human answered.
 */
export function pickCopy(copies: LoadedCard[]): LoadedCard {
  const [first, ...rest] = copies;
  if (!first) throw new Error("pickCopy needs a copy");
  if (rest.every((copy) => copy.revision === first.revision)) return first;
  const wrote = hubWrote.get(copyKey(first));
  const byHub = (copy: LoadedCard) => (copy.path === wrote ? 1 : 0);
  let best = first;
  for (const copy of rest) {
    const order =
      lastActivity(copy) - lastActivity(best) ||
      byHub(copy) - byHub(best) ||
      copy.changedMs - best.changedMs;
    if (order > 0) best = copy;
  }
  return best;
}

/**
 * The copy of each card this hub wrote last (project and id -> path). Some actions leave no
 * time in the frontmatter (a defer without a note), so on a tie in activity the copy the
 * human acted on stays the one shown, even when an agent or git touches another copy later.
 * Kept in memory: after a restart the file changed last decides a tie.
 */
const hubWrote = new Map<string, string>();
const HUB_WROTE_MAX = 500;

function copyKey(card: Pick<LoadedCard, "project" | "id">): string {
  return `${card.project}\0${card.id}`;
}

/** The latest time the card's frontmatter records something happening to it (ms). */
function lastActivity(card: LoadedCard): number {
  const fm = card.frontmatter;
  const times = [
    fm.created,
    fm.resolution?.resolved_at,
    fm.applied_at,
    fm.withdrawn?.at,
    ...fm.feedback.map((entry) => entry.at),
  ];
  let latest = 0;
  for (const time of times) {
    const ms = time === undefined ? Number.NaN : Date.parse(time);
    if (ms > latest) latest = ms;
  }
  return latest;
}

/** A broken file that is the same in several checkouts is listed once. */
function uniqueBroken(broken: BrokenCardDto[]): BrokenCardDto[] {
  const seen = new Set<string>();
  return broken
    .filter((b) => {
      const key = JSON.stringify([b.fileName, b.errors]);
      return !seen.has(key) && seen.add(key);
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
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
  project: Pick<Project, "name">,
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
        branch: card.branch,
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
export function forgetUnregisteredCards(projects: CardScope[]): void {
  const dirs = projects.flatMap((project) =>
    checkoutsIn(project).map((checkout) => decisionsDirOf(checkout) + sep),
  );
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
  project: Pick<Project, "name">,
  checkout: Checkout,
  fileName: string,
  useCache: boolean,
): Promise<LoadedCard | BrokenCardDto | undefined> {
  const path = join(checkout.path, DECISIONS_DIR, fileName);
  const broken = (errors: string[]): BrokenCardDto => ({
    project: project.name,
    fileName,
    id: parseCardFileName(fileName)?.id,
    branch: checkout.branch,
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
      // The branch isn't the file's: its checkout can switch branch and keep the file.
      return { ...cached.result, project: project.name, branch: checkout.branch };
    }

    const text = await readFile(path, "utf8");
    const parsed = parseCard(text, fileName);
    const changedMs = Math.max(
      Number(info.mtimeNs / 1_000_000n),
      Number(info.ctimeNs / 1_000_000n),
    );
    const result: LoadedCard | BrokenCardDto = parsed.ok
      ? {
          ...parsed.card,
          project: project.name,
          path,
          revision: revisionOf(text),
          branch: checkout.branch,
          changedMs,
        }
      : { project: project.name, ...parsed.problem, branch: checkout.branch };
    // Like git's "racily clean" rule: file times are coarse (a few ms), so a file changed in
    // the last couple of seconds could change again without its stamp moving. Only files
    // that have settled are cached; any later write moves ctime past the cached stamp.
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

/**
 * Finds one card by id in each checkout, reading only the files whose name starts with that
 * id. Copies that read as cards win over a broken one elsewhere ({@link pickCopy} chooses
 * between them). The registered folder's problem (no decisions/ folder, unreadable) is an
 * error, as with one folder, unless another checkout has the card.
 */
export async function findCard(project: CardScope, id: string): Promise<FindCardResult> {
  if (!CARD_ID_PATTERN.test(id)) throw new UserError(`"${id}" is not a valid card id`);
  const found = await Promise.all(
    checkoutsIn(project).map((checkout) => loadCheckout(project, checkout, id)),
  );
  const cards: LoadedCard[] = [];
  let problem: BrokenCardDto | undefined;
  for (const result of found) {
    if ("error" in result) continue;
    cards.push(...result.cards.filter((c) => c.id === id));
    problem ??= result.broken.find((b) => b.id === id);
  }
  if (cards.length > 0) {
    const picked = pickOne(cards);
    if ("card" in picked) return { ok: true, card: picked.card };
    const [twin] = picked.broken;
    if (twin) return { ok: false, broken: twin };
  }
  if (problem) return { ok: false, broken: problem };
  const first = found[0];
  if (first && "error" in first) throw new UserError(first.error, { status: 404 });
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

async function lockedCard(project: CardScope, id: string): Promise<LoadedCard> {
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
  project: CardScope,
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
  project: CardScope,
  id: string,
  revision: string,
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
  project: CardScope,
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
    case "neither":
      return "the card changed since (new options may already be on it), so your note can't be taken back";
    case "note":
    case "chat":
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

async function writeChecked(
  project: Pick<Project, "name">,
  card: LoadedCard,
  text: string,
): Promise<LoadedCard> {
  // Parse before writing: a write must never turn a valid card into a broken one.
  const reparsed = parseCard(text, card.fileName);
  if (!reparsed.ok) {
    throw new Error(`refusing to write an invalid card: ${reparsed.problem.errors.join("; ")}`);
  }
  await writeFileAtomic(card.path, text);
  const key = copyKey({ project: project.name, id: card.id });
  hubWrote.delete(key);
  hubWrote.set(key, card.path);
  if (hubWrote.size > HUB_WROTE_MAX) hubWrote.delete(hubWrote.keys().next().value as string);
  return {
    ...reparsed.card,
    project: project.name,
    path: card.path,
    revision: revisionOf(text),
    branch: card.branch,
    changedMs: Date.now(),
  };
}

export function toCardDto(card: LoadedCard): CardDto {
  return {
    project: card.project,
    id: card.id,
    fileName: card.fileName,
    revision: card.revision,
    frontmatter: card.frontmatter,
    branch: card.branch,
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

export function projectDto(project: CardScope, cards: ProjectCards): ProjectDto {
  return {
    name: project.name,
    path: project.path,
    decisionsDir: decisionsDirOf(project),
    error: cards.error,
    counts: countCards(cards),
  };
}

export async function describeProject(project: CardScope): Promise<ProjectDto> {
  return projectDto(project, await loadProjectCards(project));
}
