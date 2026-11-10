/**
 * Card files on disk: loading every card of a project, finding one by id and applying
 * actions to it.
 *
 * Path safety: cards are only ever addressed by (project name, card id). The project
 * comes from the registry, the id must match CARD_ID_PATTERN, and the file is found by
 * listing the project's decisions/ folder, so no request can reach outside it.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyAction, type CardAction } from "../core/actions.ts";
import type {
  BrokenCardDto,
  CardDetailDto,
  CardDto,
  ProjectCounts,
  ProjectDto,
} from "../core/api.ts";
import {
  type ParsedCard,
  parseCard,
  parseCardFileName,
  updateCardText,
} from "../core/card-file.ts";
import { CARD_ID_PATTERN } from "../core/schema.ts";
import { UserError } from "./errors.ts";
import { isNotFound, KeyedMutex, writeFileAtomic } from "./fs-utils.ts";
import { decisionsDirOf, type Project } from "./registry.ts";

export interface LoadedCard extends ParsedCard {
  project: string;
  path: string;
  revision: string;
}

export interface ProjectCards {
  cards: LoadedCard[];
  broken: BrokenCardDto[];
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

export async function loadProjectCards(project: Project): Promise<ProjectCards> {
  const dir = decisionsDirOf(project);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => !isIgnoredFile(n)).sort();
  } catch (error) {
    const reason = isNotFound(error)
      ? `${dir} does not exist`
      : `cannot read ${dir}: ${(error as Error).message}`;
    return { cards: [], broken: [], error: reason };
  }

  const results = await Promise.all(names.map((name) => loadFile(project, name)));
  const cards: LoadedCard[] = [];
  const broken: BrokenCardDto[] = [];
  for (const result of results) {
    if (!result) continue;
    if ("errors" in result) broken.push(result);
    else cards.push(result);
  }

  // Two files with the same id make the id ambiguous: show both as broken.
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
        errors: [`id "${card.id}" is also used by ${others.join(", ")}; give each card its own id`],
      });
    } else {
      unique.push(card);
    }
  }
  broken.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { cards: unique, broken, error: undefined };
}

async function loadFile(
  project: Project,
  fileName: string,
): Promise<LoadedCard | BrokenCardDto | undefined> {
  const path = join(decisionsDirOf(project), fileName);
  let text: string;
  try {
    // Only regular files: a symlink could point anywhere on disk.
    if (!(await lstat(path)).isFile()) return undefined;
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined; // deleted while we were listing
    return {
      project: project.name,
      fileName,
      id: parseCardFileName(fileName)?.id,
      errors: [`cannot read file: ${(error as Error).message}`],
    };
  }
  const result = parseCard(text, fileName);
  if (!result.ok) return { project: project.name, ...result.problem };
  return { ...result.card, project: project.name, path, revision: revisionOf(text) };
}

export type FindCardResult = { ok: true; card: LoadedCard } | { ok: false; broken: BrokenCardDto };

export async function findCard(project: Project, id: string): Promise<FindCardResult> {
  if (!CARD_ID_PATTERN.test(id)) throw new UserError(`"${id}" is not a valid card id`);
  const { cards, broken, error } = await loadProjectCards(project);
  if (error) throw new UserError(error, { status: 404 });
  const card = cards.find((c) => c.id === id);
  if (card) return { ok: true, card };
  const problem = broken.find((b) => b.id === id);
  if (problem) return { ok: false, broken: problem };
  throw new UserError(`no card "${id}" in project "${project.name}"`, { status: 404 });
}

const writeLock = new KeyedMutex();

/**
 * Applies an action to a card and writes it back atomically.
 * If `revision` is given and the file changed since, nothing is written (409 conflict).
 */
export async function actOnCard(
  project: Project,
  id: string,
  action: CardAction,
  options: { revision?: string | undefined; now?: Date } = {},
): Promise<LoadedCard> {
  const key = `${project.path}\0${id}`;
  return writeLock.run(key, async () => {
    const found = await findCard(project, id);
    if (!found.ok) {
      throw new UserError(`card "${id}" is broken and can't be changed until it is fixed`, {
        status: 422,
        details: found.broken.errors,
      });
    }
    const { card } = found;
    if (options.revision && options.revision !== card.revision) {
      throw new UserError("the card changed on disk since you opened it; review it again", {
        status: 409,
        code: "conflict",
      });
    }
    const result = applyAction(card, action, options.now ?? new Date());
    if (!result.ok) throw new UserError(result.error, { status: 409, code: "invalid_transition" });

    const original = await readFile(card.path, "utf8");
    if (revisionOf(original) !== card.revision) {
      throw new UserError("the card changed on disk while saving; try again", {
        status: 409,
        code: "conflict",
      });
    }
    const text = updateCardText(original, result.raw);
    await writeFileAtomic(card.path, text);

    const reparsed = parseCard(text, card.fileName);
    if (!reparsed.ok) {
      // applyAction validated the frontmatter, so this means a bug, not bad input.
      throw new Error(`wrote an invalid card: ${reparsed.problem.errors.join("; ")}`);
    }
    return { ...reparsed.card, project: project.name, path: card.path, revision: revisionOf(text) };
  });
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

export function toCardDetailDto(card: LoadedCard): CardDetailDto {
  return { ...toCardDto(card), body: card.body, sections: card.sections, path: card.path };
}

export function countCards(cards: ProjectCards): ProjectCounts {
  const counts: ProjectCounts = { open: 0, deferred: 0, resolved: 0, broken: cards.broken.length };
  for (const card of cards.cards) counts[card.frontmatter.status] += 1;
  return counts;
}

export async function describeProject(project: Project): Promise<ProjectDto> {
  const cards = await loadProjectCards(project);
  return {
    name: project.name,
    path: project.path,
    decisionsDir: decisionsDirOf(project),
    error: cards.error,
    counts: countCards(cards),
  };
}
