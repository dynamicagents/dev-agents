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
 */
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
  for (const k of Object.keys(out)) out[k] = out[k].replace(/^[>|][-+]?[ \t]*/, "").trim();
  return out;
};

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
    assert.ok(fm.description, `${name}: no description`);
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
  assert.match(skill, /--state all/, "SKILL.md no longer passes --state all on lookups");

  // The record template lives in the reference file; the keys are the contract between
  // a run that writes one and a run that reads it.
  const records = readFileSync(join(AUDIT, "references", "run-records.md"), "utf8");
  const fenced = /```yaml\r?\n([\s\S]*?)```/.exec(records);
  assert.ok(fenced, "run-records.md has no fenced record template");
  for (const key of ["covered:", "sweeps:", "next:"]) {
    assert.ok(fenced[1].includes(key), `record template is missing ${key}`);
  }
});
