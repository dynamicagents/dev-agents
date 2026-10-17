#!/usr/bin/env node
/**
 * Specs for the skills in `.agents/skills/`, run by `npm test` and so by
 * `npm run check` — which is what the `pre-commit` hook runs. There is no CI in this
 * repository, so a check that is not in `check` does not run at all.
 *
 * `scripts/skills.mjs` owns the *link* invariant: every source has a relative symlink
 * in `.claude/skills/` with a `SKILL.md` behind it. These specs own what the link
 * cannot see — whether the frontmatter Claude Code reads is well formed, and whether
 * the rules the security audit is built on are still written down.
 *
 * Claude Code drops a skill whose frontmatter it cannot parse **without reporting it**,
 * which is the same silent failure the link check exists for: a skill that stopped
 * loading looks exactly like a skill that was never useful.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, ".agents", "skills");
const AUDIT = join(SOURCE, "security-audit");

/**
 * Enough for any description here with room to spare — the longest vendored one
 * measures 606 characters. A cap this side of a kilobyte catches the real mistake,
 * which is a paragraph of body text pasted into the field.
 */
const DESCRIPTION_MAX = 1024;

const skills = readdirSync(SOURCE, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("."))
  .map((e) => e.name)
  .sort();

/**
 * The frontmatter keys, flattened. Folded scalars (`description: >-` followed by
 * indented lines) are joined into one string, which is how Claude Code reads them;
 * nested maps collapse the same way, and nothing here needs their structure.
 *
 * Not a YAML parser, and it carries the one piece of YAML that changes an answer: a
 * value may be quoted, and `"refactor"` names the same skill as `refactor`. Without
 * that, a spec meant to catch a skill Claude Code has dropped rejects one it loads
 * happily — and `""` reads as a description rather than the missing one it is.
 * `undefined` for a value whose quote never closes, which is neither.
 */
const unquote = (value) => {
  const quoted = /^(["'])([\s\S]*)$/.exec(value);
  if (!quoted) return value;
  const [, q, rest] = quoted;
  return rest.endsWith(q) ? rest.slice(0, -1) : undefined;
};

const frontmatter = (text) => {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!block) return null;
  const out = {};
  let key = null;
  for (const line of block[1].split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (top) {
      key = top[1];
      out[key] = top[2].trim();
      continue;
    }
    if (key && line.trim() !== "") out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  for (const k of Object.keys(out)) {
    out[k] = unquote(out[k].replace(/^[>|][-+]?[ \t]*/, "").trim());
  }
  return out;
};

/**
 * The reader itself, on the values that decide whether a skill loads. A reader this
 * small is only worth having if it is wrong in no case that reaches it, and the cases
 * that reach it are a quoted name and a description that is empty or unterminated.
 */
test("the frontmatter reader agrees with Claude Code on quoted values", () => {
  const fm = (body) => frontmatter(`---\n${body}\n---\n\n# body\n`);

  assert.equal(fm("name: refactor").name, "refactor");
  assert.equal(fm(`name: "refactor"`).name, "refactor", "a quoted name is the same name");
  assert.equal(fm("name: 'refactor'").name, "refactor");

  assert.equal(fm(`description: ""`).description, "", "an empty description is empty");
  assert.equal(fm(`description: "unterminated`).description, undefined);
  assert.equal(fm("name: refactor").description, undefined, "absent, not empty");

  assert.equal(
    fm("description: >-\n  first line\n  second line").description,
    "first line second line",
    "a folded scalar is one string"
  );
  assert.equal(frontmatter("# no frontmatter here\n"), null);
});

test("every skill has a SKILL.md whose name is its directory", () => {
  assert.ok(skills.length > 0, `no skills found in ${SOURCE}`);
  for (const name of skills) {
    const path = join(SOURCE, name, "SKILL.md");
    assert.ok(existsSync(path), `${name}: no SKILL.md`);
    const fm = frontmatter(readFileSync(path, "utf8"));
    assert.ok(fm, `${name}: SKILL.md has no frontmatter block`);
    assert.equal(fm.name, name, `${name}: frontmatter name is ${JSON.stringify(fm.name)}`);
  }
});

test("every skill has a description Claude Code will accept", () => {
  for (const name of skills) {
    const fm = frontmatter(readFileSync(join(SOURCE, name, "SKILL.md"), "utf8"));
    // `fm?.` and not `fm.`: a malformed block fails the spec above with a sentence that
    // names the problem, and this one should not bury it under a TypeError.
    assert.ok(fm?.description, `${name}: no description`);
    assert.ok(
      fm.description.length <= DESCRIPTION_MAX,
      `${name}: description is ${fm.description.length} characters, over ${DESCRIPTION_MAX}`
    );
  }
});

/**
 * Pinning prose, deliberately. These are the rules that keep a vulnerability out of a
 * public place and keep run bookkeeping from growing into the omnibus issue it is not
 * allowed to be. Rewording one should cost a deliberate edit here, not pass silently.
 */
const GUARDRAILS = [
  "Report only",
  "private advisory in the owning repository",
  "Never a public issue",
  "One issue per run",
  "never closes, reopens, edits or comments",
  "no GHSA ids",
  "Never read, echo, log or copy a credential",
];

test("the security-audit guardrail block is intact", () => {
  const text = readFileSync(join(AUDIT, "SKILL.md"), "utf8");
  const block = /<!-- guardrail:start -->([\s\S]*?)<!-- guardrail:end -->/.exec(text);
  assert.ok(block, "security-audit/SKILL.md has no guardrail block");
  for (const phrase of GUARDRAILS) {
    assert.ok(block[1].includes(phrase), `guardrail block no longer says: ${phrase}`);
  }
});

test("the run-record contract a later run reads is still written down", () => {
  const skill = readFileSync(join(AUDIT, "SKILL.md"), "utf8");
  assert.match(skill, /gh label create security-audit/, "SKILL.md no longer names the label");

  // The record template lives in the reference file; the keys are the contract between
  // a run that writes one and a run that reads it.
  const records = readFileSync(join(AUDIT, "references", "run-records.md"), "utf8");
  const fenced = /```yaml\r?\n([\s\S]*?)```/.exec(records);
  assert.ok(fenced, "run-records.md has no fenced record template");
  for (const key of ["covered:", "sweeps:", "next:"]) {
    assert.ok(fenced[1].includes(key), `record template is missing ${key}`);
  }
});

/**
 * Every lookup, not the file. A record is closed once its owner has read it, so a
 * lookup without `--state all` sees almost nothing and a run reads its own coverage as
 * empty — it re-audits a slice and skips the one that was due. Matching the flag
 * anywhere in the file would pass on the two sentences that merely discuss it.
 */
test("every record lookup passes --state all", () => {
  for (const file of ["SKILL.md", join("references", "run-records.md")]) {
    const text = readFileSync(join(AUDIT, file), "utf8").replace(/\\\r?\n\s*/g, " ");
    const calls = text.split(/\r?\n/).filter((line) => line.includes("gh issue list"));
    assert.ok(calls.length > 0, `${file}: no gh issue list left to check`);
    for (const call of calls) {
      assert.ok(call.includes("--state all"), `${file}: a lookup drops --state all:${call}`);
    }
  }
});

/**
 * The rotation table's second column is the only thing that says what a slice reads, so
 * a path that stops resolving is a slice that audits nothing — and the run records
 * cannot show it, because coverage is the union of slice *ids*. A slice whose paths have
 * rotted reports as covered forever.
 *
 * Rows name a repository once and then continue in its shorthand (`src/limits.ts` after
 * `g2a-protocol/src/paths.ts`), which is why the repo carries across the row. Skipped
 * for a submodule that is not checked out: `submodules:check` owns that, and `npm test`
 * has to stay runnable in a clone that has not bootstrapped.
 */
test("every path in the rotation table resolves", () => {
  const rows = readFileSync(join(AUDIT, "SKILL.md"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 3 && /^`[a-z0-9-]+\/[a-z+-]+`$/.test(cells[1]));
  assert.ok(rows.length > 0, "SKILL.md has no rotation rows");

  const checkedOut = (name) => existsSync(join(root, name, ".git"));
  const submodules = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && checkedOut(e.name))
    .map((e) => join(root, e.name));
  let checked = 0;

  for (const [, id, covers] of rows) {
    // The row's repository comes from its id, and a shorthand path continues in it.
    // `dev-agents` is this checkout, so it resolves from the root; `all/ci` names a path
    // every repo has rather than one of its own, and one repo having it is enough —
    // this workspace does not, which is why the spec lives in `check`.
    const repo = id.slice(1, -1).split("/")[0];
    if (repo !== "all" && repo !== "dev-agents" && !checkedOut(repo)) continue;
    const bases = repo === "all" ? [root, ...submodules] : [root, join(root, repo)];

    for (const [, cited] of covers.matchAll(/`([A-Za-z0-9_.][A-Za-z0-9_./+-]*)`/g)) {
      if (!cited.includes("/") && !cited.includes(".")) continue; // a word, not a path
      const resolved = bases.map((b) => join(b, cited)).filter(existsSync);
      assert.ok(resolved.length > 0, `rotation row ${id} names ${cited}, which is not there`);
      checked += 1;
    }
  }
  assert.ok(checked > 20, `only ${checked} rotation paths checked — the row parser stopped matching`);
});
