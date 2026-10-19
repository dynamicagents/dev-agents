#!/usr/bin/env node
/**
 * Specs for the skills in `.agents/skills/`, run by `npm test` and so by
 * `npm run check`, which is what the `pre-commit` hook runs. There is no CI in this
 * repository, so a check that is not in `check` does not run at all.
 *
 * `scripts/skills.mjs` owns the *link* invariant: every source has a relative symlink
 * in `.claude/skills/` with a `SKILL.md` behind it. These specs own what the link
 * cannot see: whether the frontmatter Claude Code reads is well formed, and whether
 * the rules a discovery run is built on are still written down.
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
import { declared, tryGit } from "./submodule-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, ".agents", "skills");

/**
 * The skills written here, by the names a caller types to select one. Selection is
 * prompt-only (`AGENTS.md`, "The prompt names the skill"): a `/<name>` line, validated
 * nowhere, so a rename turns every prompt naming the old one into an ordinary session
 * rather than an error anybody sees. This list is what makes such a rename deliberate.
 */
const DISCOVERY = [
  "security-audit-discovery",
  "refactor-discovery",
  "restructure-discovery"
];
const AUDIT = join(SOURCE, "security-audit-discovery");

/**
 * The label the audit's run records are filed and found under. It indexes records, not
 * findings (an advisory cannot carry a label), so it is the one name the rename to
 * `security-audit-discovery` deliberately left alone: records already filed under it
 * have to stay findable. `AGENTS.md` says so where a reader meets the rule.
 */
const AUDIT_LABEL = "security-audit";

/**
 * Enough for any description here with room to spare: the longest vendored one
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
 * value may be quoted, and `"refactor-discovery"` names the same skill as
 * `refactor-discovery`. Without that, a spec meant to catch a skill Claude Code has
 * dropped rejects one it loads happily, and `""` reads as a description rather than
 * the missing one it is. `undefined` for a value whose quote never closes, which is
 * neither.
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

  assert.equal(fm("name: refactor-discovery").name, "refactor-discovery");
  assert.equal(
    fm(`name: "refactor-discovery"`).name,
    "refactor-discovery",
    "a quoted name is the same name"
  );
  assert.equal(fm("name: 'refactor-discovery'").name, "refactor-discovery");

  assert.equal(fm(`description: ""`).description, "", "an empty description is empty");
  assert.equal(fm(`description: "unterminated`).description, undefined);
  assert.equal(fm("name: refactor-discovery").description, undefined, "absent, not empty");

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
 * A discovery run is selected by a caller, never picked up off its description: the
 * runs file public issues and private advisories, and a model reading "security" in a
 * prompt must not be able to start one. `disable-model-invocation` is the field that
 * makes that structural, and it costs nothing at the naming end: the CLI still loads a
 * skill that sets it, and a `/<name>` line still selects it.
 *
 * The neighbour check is the other half. A description that does not say which skill it
 * is *not* is how a caller picks the wrong one: Claude Code ships `security-review`,
 * `code-review` and `simplify`, all diff- or pull-request-scoped, and two of them apply
 * fixes. Those are Claude Code's own and nothing here can see whether they exist, so
 * what is checkable is the half that is ours: a description names another skill this
 * workspace installs, and a rename cannot leave it pointing at nothing.
 */
test("each discovery skill is selected rather than inferred, and says what it is not", () => {
  const installed = new Set(skills);
  for (const name of DISCOVERY) {
    assert.ok(installed.has(name), `${name} is not a skill here`);
    const fm = frontmatter(readFileSync(join(SOURCE, name, "SKILL.md"), "utf8"));
    assert.equal(
      fm?.["disable-model-invocation"],
      "true",
      `${name}: a discovery run must not be model-invocable`
    );
    assert.match(
      fm.description,
      /Discovery only/,
      `${name}: the description does not say the run is discovery only`
    );
    const neighbours = skills.filter(
      (other) => other !== name && fm.description.includes(`\`${other}\``)
    );
    assert.ok(
      neighbours.length > 0,
      `${name}: the description names no installed skill it is not`
    );
  }
});

/**
 * Pinning prose, deliberately: the rules that have no structural form. These are what
 * keep a vulnerability out of a public place, keep a run from filing a candidate nobody
 * can re-check, and keep run bookkeeping from growing into the omnibus issue it is not
 * allowed to be. Rewording one should cost a deliberate edit here, not pass silently.
 *
 * Split by home: the first set is shared by every discovery run and lives in the
 * workspace `AGENTS.md`; the second is the audit's own, in its guardrail block. One
 * home per fact, checked in both places it is stated.
 */
const DISCOVERY_RULES = [
  "impact never promotes a class",
  // The sentence, not the heading above it: a heading survives a rewrite of the rule
  // it introduces, and the cap is the rule.
  "files **at most three**",
  "No source changes",
  "Never closes, reopens, edits or comments",
  "Never reads, echoes, logs or copies a credential",
  "One record per opportunity",
  "full-SHA permalink with a line range",
  "Every lookup passes `--state all`",
  "Never reopen",
  "Do not re-file",
  "disable-model-invocation: true",
];

const GUARDRAILS = [
  "Report only",
  "private advisory in the owning repository",
  "Never a public issue",
  "impact never promotes a class",
  "At most three findings are filed in a run",
  "One issue per run",
  "never closes, reopens, edits or comments",
  // The whole content rule, not its first item: this is the sentence that keeps a
  // vulnerability out of the one public thing the audit writes, and the items with no
  // shape (a count, a title, a path offered as the location of a problem) are the
  // ones no grep over a draft can catch.
  "**no GHSA ids**, no advisory links, no vulnerability detail, no titles, no severities, no CWEs, no counts, no pending-item notes, and no path presented as the location of a problem",
  "Never read, echo, log or copy a credential",
];

/**
 * The calls in `text` that name `command`, one line each.
 *
 * A `\`-continued command is **one** call and is joined back into the line that opened
 * it: a flag on the second line of one reads as absent otherwise, which is how a rule
 * about flags passes on a command that breaks it.
 */
const callsNaming = (text, command) =>
  text
    .replace(/\\\r?\n\s*/g, " ")
    .split(/\r?\n/)
    .filter((line) => line.includes(command));

/** Where a discovery run's `gh` lookups are written down. */
const LOOKUP_FILES = [
  ...DISCOVERY.map((name) => join(name, "SKILL.md")),
  join("security-audit-discovery", "references", "run-records.md")
];

/**
 * Prose with its wrapping taken out, which is how a pinned phrase is matched: these
 * files are wrapped by hand, so a phrase that happens to straddle a line break would
 * otherwise read as absent and a reflow nobody meant as a change would fail a spec
 * about disclosure.
 */
const unwrapped = (text) => text.replace(/\s+/g, " ");

/** One `## ` section of a markdown file, by heading, without the headings after it. */
const section = (text, heading) => {
  const from = text.indexOf(`## ${heading}\n`);
  if (from === -1) return undefined;
  const rest = text.slice(from);
  const next = rest.slice(1).search(/\n## [^#]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

test("the rules every discovery run shares are still in AGENTS.md", () => {
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
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

test("the security-audit-discovery guardrail block is intact", () => {
  const text = readFileSync(join(AUDIT, "SKILL.md"), "utf8");
  const block = /<!-- guardrail:start -->([\s\S]*?)<!-- guardrail:end -->/.exec(text);
  assert.ok(block, "security-audit-discovery/SKILL.md has no guardrail block");
  const rules = unwrapped(block[1]);
  for (const phrase of GUARDRAILS) {
    assert.ok(rules.includes(phrase), `guardrail block no longer says: ${phrase}`);
  }
});

test("the run-record contract a later run reads is still written down", () => {
  const skill = readFileSync(join(AUDIT, "SKILL.md"), "utf8");

  // The label indexes run records and is deliberately **not** renamed with the skill:
  // a label cannot index an advisory, so it keeps the name the records were filed
  // under. What has to hold is that the name created is the name looked up: a
  // half-rename leaves the lap reading as empty, which is indistinguishable from a lap
  // that genuinely covered nothing.
  const created = [...skill.matchAll(/gh label create (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(created, [AUDIT_LABEL], `SKILL.md creates ${created.join(", ") || "no label"}`);
  const queried = [...skill.matchAll(/--label (\S+)/g)].map((m) => m[1]);
  assert.ok(queried.length > 0, "SKILL.md looks a record up under no label");
  for (const name of queried) {
    assert.equal(name, AUDIT_LABEL, `SKILL.md files under ${AUDIT_LABEL} and looks up ${name}`);
  }

  // The record template lives in the reference file; the keys are the contract between
  // a run that writes one and a run that reads it. `lap` is the window: without it a
  // later run cannot tell which records count as coverage.
  const records = readFileSync(join(AUDIT, "references", "run-records.md"), "utf8");
  const fenced = /```yaml\r?\n([\s\S]*?)```/.exec(records);
  assert.ok(fenced, "run-records.md has no fenced record template");
  for (const key of ["lap:", "covered:", "sweeps:", "next:"]) {
    assert.ok(fenced[1].includes(key), `record template is missing ${key}`);
  }
});

/**
 * Every lookup in every discovery skill, not the file. A record is closed once its
 * owner has read it, so a lookup without `--state all` sees almost nothing: the audit
 * reads its own coverage as empty and re-sweeps a slice while skipping the one that was
 * due, and a refactor or restructure run re-files an opportunity somebody has already
 * declined. Matching the flag anywhere in the file would pass on the prose that merely
 * discusses it.
 */
test("every record lookup passes --state all", () => {
  for (const file of LOOKUP_FILES) {
    const calls = callsNaming(readFileSync(join(SOURCE, file), "utf8"), "gh issue list");
    assert.ok(calls.length > 0, `${file}: no gh issue list left to check`);
    for (const call of calls) {
      assert.ok(call.includes("--state all"), `${file}: a lookup drops --state all:${call}`);
    }
  }
});

/**
 * A lookup's page, which is the other half of reading history: `gh` returns 30 by
 * default, and a run that reads 30 of a repository's issues or 30 of its labels draws
 * the same conclusion from a truncated answer as from a complete one: it re-files what
 * it could not see, and creates a label that is already there.
 */
test("every record and label lookup asks for a page that holds a lap", () => {
  for (const file of LOOKUP_FILES) {
    const text = readFileSync(join(SOURCE, file), "utf8");
    for (const command of ["gh issue list", "gh label list"]) {
      for (const call of callsNaming(text, command)) {
        assert.match(call, /--limit \d+/, `${file}: a lookup takes gh's default page:${call}`);
        const limit = Number(/--limit (\d+)/.exec(call)[1]);
        assert.ok(limit >= 100, `${file}: a lookup reads only ${limit}:${call}`);
      }
    }
  }
});

/**
 * A label is the index a later run finds a record by, and `gh label create --force`
 * updates the colour and description of one that already exists. That is an edit, and no
 * discovery run makes one. So a skill that creates a label asks whether it is there
 * first.
 */
test("no discovery skill creates a label with --force", () => {
  for (const name of DISCOVERY) {
    const text = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8");
    const creates = callsNaming(text, "gh label create");
    for (const line of creates) {
      assert.ok(!line.includes("--force"), `${name}: a label is created with --force:${line}`);
    }
    if (creates.length > 0) {
      assert.match(
        text,
        /gh label list/,
        `${name}: creates a label without a lookup saying it is absent`
      );
    }
  }
});

/**
 * The rotation table, as `{ id, repo, slice, covers }` per row: the one parser both
 * coverage specs below read it through.
 *
 * Rows name a repository once and then continue in its shorthand (`src/limits.ts` after
 * `g2a-protocol/src/paths.ts`), which is why the repo carries across the row rather than
 * being read off each path.
 *
 * A slice id carries digits as readily as a repo name does (`core/a2a`), and a pattern
 * that rejects them drops the row silently, which is a slice no spec here can see.
 */
const rotation = () =>
  readFileSync(join(AUDIT, "SKILL.md"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 3 && /^`[a-z0-9-]+\/[a-z0-9+-]+`$/.test(cells[1]))
    .map(([, id, covers]) => {
      const [repo, slice] = id.slice(1, -1).split("/");
      return { id: id.slice(1, -1), repo, slice, covers };
    });

/** The paths a row cites, in the repo's shorthand whichever spelling the row used. */
const cited = ({ repo, covers }) =>
  [...covers.matchAll(/`([A-Za-z0-9_.][A-Za-z0-9_./+-]*)`/g)]
    .map(([, path]) => path)
    .map((path) => (path.startsWith(`${repo}/`) ? path.slice(repo.length + 1) : path));

/**
 * The slice id every repository's catch-all row ends in. A `…/rest` row covers whatever
 * no other row names, which is what keeps a module nobody wrote a row for inside the
 * rotation instead of outside it.
 */
const CATCH_ALL = "rest";

/** This workspace, and every repository it declares. `all` is a rotation id, not a repo. */
const REPOS = ["dev-agents", ...[...declared(root).values()].map(({ path }) => path)];

const checkedOut = (repo) => repo === "dev-agents" || existsSync(join(root, repo, ".git"));
const baseOf = (repo) => (repo === "dev-agents" ? root : join(root, repo));

/**
 * Table to disk. The rotation table's second column is the only thing that says what a
 * slice reads, so a path that stops resolving is a slice that audits nothing, and the
 * run records cannot show it, because coverage is the union of slice *ids*. A slice whose
 * paths have rotted reports as covered forever.
 *
 * Skipped for a submodule that is not checked out, so the failure reads as the rotted
 * path it is rather than as a missing checkout; `submodules:check` owns whether they are
 * there. The rest of the suite runs without any of them and this test does not: `all/ci`
 * needs a repository that has `.github/workflows`, and this workspace has none of its own.
 */
test("every path in the rotation table resolves", () => {
  const rows = rotation();
  assert.ok(rows.length > 0, "SKILL.md has no rotation rows");

  const submodules = REPOS.filter((r) => r !== "dev-agents" && checkedOut(r)).map(baseOf);
  let checked = 0;

  for (const row of rows) {
    // A row's paths resolve in the repository whose slice will read them and nowhere
    // else, which is what makes a path left behind by a module that moved repos fail
    // here. `all/ci` is the exception: it names a path every repo has rather than one of
    // its own, and one repo having it is enough; this workspace does not have it, which
    // is why the row is checked against the submodules and not the root alone.
    if (row.repo !== "all" && !checkedOut(row.repo)) continue;
    const bases = row.repo === "all" ? [root, ...submodules] : [baseOf(row.repo)];

    for (const path of cited(row)) {
      if (!path.includes("/") && !path.includes(".")) continue; // a word, not a path
      const resolved = bases.map((b) => join(b, path)).filter(existsSync);
      assert.ok(resolved.length > 0, `rotation row ${row.id} names ${path}, which is not there`);
      checked += 1;
    }
  }
  assert.ok(checked > 20, `only ${checked} rotation paths checked: the row parser stopped matching`);
});

/**
 * Disk to table, which is the direction a table of enumerated paths loses on its own.
 * The rotation section of `security-audit-discovery/SKILL.md` says why, and this is what
 * the `…/rest` rows there cannot hold about themselves:
 *
 * - every repository has a catch-all, so nothing in it can be unclaimed;
 * - every row names a repository that exists, since the spec above skips one that does
 *   not and a mistyped repo would otherwise be a slice that never runs;
 * - a top-level module under a repo's `src/` is named by a row that is not the catch-all,
 *   so the catch-all carries a new module until the table catches up rather than forever.
 *
 * The repository list comes from `.gitmodules` rather than a directory listing, so a row
 * naming a repository nobody declares is caught in a clone that has not bootstrapped too.
 * Reading a repository's `src/` needs its checkout, and skips without it.
 */
test("every repository has a catch-all, and every src module has a row of its own", () => {
  const rows = rotation();
  assert.ok(REPOS.length > 1, `only ${REPOS.join(", ")}: .gitmodules did not parse`);

  const known = new Set([...REPOS, "all"]);
  for (const { id, repo } of rows) {
    assert.ok(known.has(repo), `rotation row ${id} names ${repo}, which is not a repository here`);
  }

  for (const repo of REPOS) {
    const mine = rows.filter((row) => row.repo === repo);
    assert.ok(mine.length > 0, `${repo} has no rotation row, so the audit never reaches it`);
    const catchAll = mine.filter((row) => row.slice === CATCH_ALL);
    assert.equal(
      catchAll.length,
      1,
      `${repo} has ${catchAll.length} ${repo}/${CATCH_ALL} rows, and needs exactly one`
    );

    if (!checkedOut(repo)) continue;
    const named = mine.filter((row) => row.slice !== CATCH_ALL).flatMap(cited);

    // What git tracks, not what the directory holds. A rotation row can only ever be
    // written for a committed module, and this spec runs inside `check` and so inside the
    // pre-commit hook: enumerate the directory instead and one editor scratch file under
    // any repo's `src/` blocks every commit in the workspace, telling whoever hits it to
    // go and edit a rotation table.
    const tracked = tryGit(["ls-files", "src"], baseOf(repo)) ?? "";
    const modules = tracked
      .split("\n")
      .filter((path) => path && !path.endsWith(".spec.ts")) // a spec is not a surface
      .map((path) => path.split("/").slice(0, 2).join("/"));

    for (const path of new Set(modules)) {
      assert.ok(
        named.some((p) => p === path || p.startsWith(`${path}/`)),
        `${repo}/${path} is in no slice but ${repo}/${CATCH_ALL}, so give it a row of its own`
      );
    }
  }
});
