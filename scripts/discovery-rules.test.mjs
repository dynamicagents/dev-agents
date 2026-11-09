#!/usr/bin/env node
/**
 * Specs for the rules every discovery run shares, which live in this workspace's
 * `AGENTS.md` under "Discovery runs", and for the pointers the discovery skills make into
 * it. Run by `npm test`, and so by `npm run check`, which is what the `pre-commit` hook
 * runs.
 *
 * The skills themselves are authored in `dynamicagents/dev-skills`, whose specs pin what
 * each skill says. What only this repository can check is the other half: that the rules a
 * skill defers to are still here, and that every heading a skill cites still exists. So
 * these read the installed copies in `.agents/skills/`, which are committed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, ".agents", "skills");
const AGENTS_MD = join(root, "AGENTS.md");

/** The discovery skills, by the names a caller puts in a prompt. */
const DISCOVERY = ["security-audit-discovery", "issue-discovery", "restructure-discovery"];

/**
 * Pinning prose, deliberately: the rules every discovery run shares and that have no
 * structural form. Rewording one should cost a deliberate edit here, not pass silently.
 * The skills' own rules are pinned in `dynamicagents/dev-skills`.
 */
const DISCOVERY_RULES = [
  "impact never promotes a class",
  // The sentence, not the heading above it: a heading survives a rewrite of the rule
  // it introduces, and the cap is the rule.
  "files **at most three**",
  // The two halves of a cap that cannot be gamed: a weaker candidate must not be
  // promoted into it, and the bar it is measured against must not be moved to reach it.
  "Never lower a bar to fill the cap",
  // A run is handed its history and knows nothing it was not handed, which is only safe
  // while a run that was handed nothing says so instead of reporting a clean window.
  "Absent history is not evidence of novelty",
  "No source changes",
  "Never closes, reopens, edits or comments",
  "Never reads, echoes, logs or copies a credential",
  "One record per opportunity",
  // The rule's one exception, pinned beside it: a bundle that lost its task list is the
  // grouped record the rule exists to refuse, closable and dedupable only as a whole.
  "The one exception is a bundle",
  "full-SHA permalink with a line range",
  "Every lookup passes `--state all`",
  "Never reopen",
  "Do not re-file",
  "disable-model-invocation: true",
];

/**
 * Prose with its wrapping taken out, which is how a pinned phrase is matched: these
 * files are wrapped by hand, so a phrase that happens to straddle a line break would
 * otherwise read as absent and a reflow nobody meant as a change would fail a spec
 * about disclosure.
 */
const unwrapped = (text) => text.replace(/\s+/g, " ");

/**
 * One `## ` section of a markdown file, by heading, without the headings after it.
 *
 * Line by line rather than by offset, for the two reasons every other helper here splits
 * on `\r?\n`: a CRLF checkout would otherwise find no section at all, and an exact match
 * on the whole line means a `###` heading of the same text is a different heading rather
 * than one that ends the slice early.
 */
const section = (text, heading) => {
  const lines = text.split(/\r?\n/);
  const from = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (from === -1) return undefined;
  const next = lines.findIndex((line, at) => at > from && /^## [^#]/.test(line));
  return lines.slice(from, next === -1 ? undefined : next).join("\n");
};

test("the rules every discovery run shares are still in AGENTS.md", () => {
  const text = readFileSync(AGENTS_MD, "utf8");
  const runs = section(text, "Discovery runs");
  assert.ok(runs, "AGENTS.md has no `## Discovery runs` section");
  const prose = unwrapped(runs);
  for (const phrase of DISCOVERY_RULES) {
    assert.ok(prose.includes(phrase), `the Discovery runs section no longer says: ${phrase}`);
  }
  // Each skill defers to that section rather than restating it. The section by name:
  // `AGENTS.md` is mentioned all over a skill, so matching the file name passes on a
  // skill that dropped the pointer entirely.
  for (const name of DISCOVERY) {
    const skill = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8");
    assert.match(
      skill,
      /under "Discovery runs"/,
      `${name}: SKILL.md points at no shared rules`
    );
  }
});

/**
 * Every heading of a markdown file, by its text. Fenced blocks are skipped: `AGENTS.md`
 * writes `#` comments into the `gh api graphql` calls it documents, and a comment is not
 * a heading anything can cite.
 */
const headings = (text) => {
  const found = new Set();
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced) {
      const heading = /^#{1,6}[ \t]+(.+?)[ \t]*#*$/.exec(line);
      if (heading) found.add(heading[1]);
    }
  }
  return found;
};

/**
 * How a file here cites a section of the workspace `AGENTS.md`: the word `under`, then
 * the heading in double quotes. One form, because a spec can only check the citations it
 * can find, and the one it is for is the citation nobody remembered on a rename. A
 * citation written some other way is prose, and this sees none of it.
 *
 * The form names a heading in *this* workspace's file. Each repository's own `AGENTS.md`
 * is referred to all over these skills, and in `AGENTS.md` too, and none of those is read
 * here, so a citation of a heading in one of them has to say so some other way, which is
 * the parenthetical `AGENTS.md` already uses for them.
 *
 * Assembled rather than written as a literal, because this file is one of the files the
 * spec reads: a literal would spell a citation of its own capture group.
 */
const QUOTE = '"';
const CITATION = new RegExp(`under ${QUOTE}([^${QUOTE}]+)${QUOTE}`, "g");

/**
 * What cites a heading here: a discovery skill's markdown, this file, and `AGENTS.md`
 * itself, which cites one of its own sections. A self-citation orphans just as quietly:
 * the pointer is in the opening prose and the heading it names is sections below, so a
 * rename does not put the two in front of the same reader.
 *
 * Read in the spec rather than at module scope: a renamed skill directory throws here,
 * and a throw at module scope lands before any spec runs, burying the sentence that names
 * the rename under a stack trace.
 */
const citing = () => [
  ...DISCOVERY.flatMap((name) =>
    readdirSync(join(SOURCE, name), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(entry.parentPath, entry.name))
  ),
  AGENTS_MD,
  fileURLToPath(import.meta.url)
];

/**
 * A renamed heading orphans every citation of it in silence: no skill stops loading, no
 * link visibly breaks, and the pointer a reader follows for why a run works the way it
 * does arrives at a section that is not there. Without this, what catches a rename is
 * whoever thought to grep for the old heading, which is the same reader who renamed it.
 *
 * It fails in both directions, which is the point: the heading moving away from its
 * citations, and a citation written for a heading nobody added.
 */
test("every AGENTS.md section these files cite is one AGENTS.md has", () => {
  const sections = headings(readFileSync(AGENTS_MD, "utf8"));
  let checked = 0;

  for (const file of citing()) {
    // Wrapping out first: these files are wrapped by hand, and a citation straddles a
    // line break as readily as a pinned phrase does.
    for (const [, name] of unwrapped(readFileSync(file, "utf8")).matchAll(CITATION)) {
      // Which `AGENTS.md`, because the likely mistake is a citation of a repository's
      // own: the heading is really there, so a message that does not say which file was
      // read sends the reader to look for the mistake in the wrong one.
      assert.ok(
        sections.has(name),
        `${relative(root, file)} cites "${name}", which the workspace AGENTS.md has no heading for`
      );
      checked += 1;
    }
  }

  // Each discovery skill carries at least the pointer the spec above requires of it, so
  // fewer than one apiece is the extractor having stopped matching rather than a run of
  // files that cite nothing.
  assert.ok(checked >= DISCOVERY.length, `only ${checked} citations found to check`);
});
