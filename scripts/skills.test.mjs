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
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, ".agents", "skills");
const AGENTS_MD = join(root, "AGENTS.md");

/**
 * The skills written here, by the names a caller puts in a prompt. Selection is
 * prompt-only (`AGENTS.md`, under "The prompt names the skill"), so a rename leaves
 * every prompt naming the old one running as an ordinary session: the CLI tells that
 * session its `/<name>` line did not run, and whether the caller hears it is the
 * report's business. This list is what makes such a rename deliberate.
 */
const DISCOVERY = ["security-audit-discovery", "refactor-discovery"];
const AUDIT = join(SOURCE, "security-audit-discovery");
const REFACTOR = join(SOURCE, "refactor-discovery");

/**
 * One skill's own markdown: its `SKILL.md` and everything it points at. Several specs
 * below read a whole set, because a rule the skill states and a reference file restates is
 * a rule either file can break.
 *
 * Per skill rather than over all of them, because the two runs write to opposite kinds of
 * store and the specs that matter most are the ones asserting that each writes to its own:
 * a set pooling both files would pass a rule the audit broke as long as the refactor run
 * kept it.
 */
const markdownUnder = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));

const auditFiles = () => markdownUnder(AUDIT);
const refactorFiles = () => markdownUnder(REFACTOR);

/**
 * Enough for any description here with room to spare: the longest measures 831
 * characters, which is the audit's own, and the longest vendored one 604. A cap this side
 * of a kilobyte catches the real mistake, which is a paragraph of body text pasted into
 * the field rather than a description somebody meant to be long.
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
 * value may be quoted, and `"security-audit-discovery"` names the same skill as
 * `security-audit-discovery`. Without that, a spec meant to catch a skill Claude Code
 * has dropped rejects one it loads happily, and `""` reads as a description rather than
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

  assert.equal(fm("name: security-audit-discovery").name, "security-audit-discovery");
  assert.equal(
    fm(`name: "security-audit-discovery"`).name,
    "security-audit-discovery",
    "a quoted name is the same name"
  );
  assert.equal(fm("name: 'security-audit-discovery'").name, "security-audit-discovery");

  assert.equal(fm(`description: ""`).description, "", "an empty description is empty");
  assert.equal(fm(`description: "unterminated`).description, undefined);
  assert.equal(
    fm("name: security-audit-discovery").description,
    undefined,
    "absent, not empty"
  );

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
 * A discovery run is selected by a caller, never picked up off its description: a run
 * files private advisories, and a model reading "security" in a prompt must not be able to
 * start one. `disable-model-invocation` is the field that makes that structural, and it
 * costs nothing at the naming end: the CLI still loads a skill that sets it, and a
 * `/<name>` line still selects it. It also keeps the description out of context until the
 * skill is named, which is why a long one costs nothing here.
 *
 * The other half of a caller choosing right is a description that says which skill this
 * one is *not*, and **nothing here asserts that half**. The skills a discovery run is
 * confused with are Claude Code's own: `security-review`, `code-review` and `simplify`,
 * all diff- or pull-request-scoped, and two of them apply fixes. Nothing in this
 * workspace can see whether one of those exists, let alone that it still answers to that
 * name, so a spec over the description could only check that it names a skill installed
 * *here*, which is a different claim and not one the description has any reason to
 * satisfy. "Discovery only" is the part that is ours, and it is the part pinned.
 */
test("each discovery skill is selected rather than inferred, and discovers only", () => {
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
  "full-SHA permalink with a line range",
  "Every lookup passes `--state all`",
  "Never reopen",
  "Do not re-file",
  "disable-model-invocation: true",
];

/**
 * Per skill, because a guardrail block is where a run's destination is written down and
 * the two runs have opposite ones: the audit's rules keep a vulnerability out of anywhere
 * public, and the refactor run's keep a run that files public issues from editing them,
 * from filing a breaking change, and from claiming it proved something it never ran.
 * Pooling the phrases would let either skill satisfy the other's rules.
 *
 * Every name in `DISCOVERY` needs an entry, asserted below: a skill added without one
 * would be a discovery run whose guardrail block nothing reads.
 */
const GUARDRAILS = {};

GUARDRAILS["security-audit-discovery"] = [
  "Report only",
  "private advisory in the owning repository",
  "Never a public issue",
  "impact never promotes a class",
  "At most three findings are filed in a run",
  // The floor, pinned with what may not move it. Every item after "Never" is a pressure
  // a run is genuinely under, and lowering the floor under any of them turns the audit
  // into a generator of findings nobody asked for.
  "`min_severity` starts at `high`, and only an explicit instruction from the invoking agent lowers it",
  "One report per run",
  "never closes, reopens, edits or comments",
  // The whole content rule, not its first item: this is the sentence that keeps a
  // vulnerability out of the one thing a run writes that a link reaches, and the items
  // with no shape (a sequence a summary walks, a component named in other words) are
  // the ones no grep over a draft can catch.
  "no exploit evidence, no affected repository, component or path, no GHSA ids, no advisory links, no severities, no CWEs, and no detail a reader could act on",
  "Never read, echo, log or copy a credential",
  // The sentence that bounds everything a run creates, pinned whole for its last item:
  // a handoff path inside a checkout is one `git add -A` away from being the public
  // disclosure the advisory route exists to avoid, so `/tmp` is the requirement rather
  // than a convenience. Nothing else here fails on a path moved into the repository.
  "The run's own writes are limited to: an advisory report per confirmed finding, the report it hands back, and files under `/tmp/security-audit-handoff/`",
];

GUARDRAILS["refactor-discovery"] = [
  // The first failure to prevent, and the one a refactor run is uniquely exposed to: a
  // run that finds a simplification and applies it has stopped being a discovery run.
  "Report only",
  "public issues in the repositories that own the code",
  // The finding unit. Without this a root cause spanning four repositories is either one
  // issue nobody but its owner can close, or four findings against a cap of three.
  "One finding is one root cause",
  "creates no label",
  "Never a pull request, a branch, a commit or a patch",
  "impact never promotes a class",
  // The honest limit. A run writes no patch, so every behaviour claim it makes is about a
  // change nobody has made: dropping this sentence turns a bounded claim into a promise.
  "never establishes that a change is behaviour-neutral",
  // The surface is every line by decision, and the row-per-kind bar is what replaces the
  // category exclusion that was considered and rejected: there is no CI in this
  // repository, so a finding that thins the suite without naming the spec that still
  // catches the mistake is the one way this run can do real damage.
  "Every line is candidate surface",
  "A constraint the code already states is a prior disposition",
  // The cap and the stop condition are the same number here, which is what makes the
  // floor below the only thing between a run and three mediocre findings.
  "At most three findings are filed in a run, and the run stops the moment its third is confirmed",
  "`min_tier` starts at `recurring`, and only an explicit instruction from the invoking agent lowers it, and only to `local`",
  "`cosmetic` is never filed at any floor",
  // The boundary with the sibling run that does not exist yet. Without it, the riskiest
  // changes arrive as issues that read like refactors.
  "A breaking change is out of scope",
  "One report per run",
  "never closes, reopens, edits or comments",
  "Never read, echo, log or copy a credential",
  // This run reads six checkouts and may run commands in them, and some of those commands
  // write: starter's `check` regenerates its runtime types. A dirty checkout is how a
  // discovery run leaves a change behind.
  "Every checkout is left clean",
  "the run's own writes are limited to: the issues of a confirmed finding, the report it hands back, and files under `/tmp/refactor-discovery/`",
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

test("every discovery skill's guardrail block is intact", () => {
  for (const name of DISCOVERY) {
    const phrases = GUARDRAILS[name];
    assert.ok(phrases, `${name}: no guardrail phrases are pinned for it`);
    const text = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8");
    const block = /<!-- guardrail:start -->([\s\S]*?)<!-- guardrail:end -->/.exec(text);
    assert.ok(block, `${name}/SKILL.md has no guardrail block`);
    const rules = unwrapped(block[1]);
    for (const phrase of phrases) {
      assert.ok(rules.includes(phrase), `${name}: guardrail block no longer says: ${phrase}`);
    }
  }
});


/** The fenced block of `text` in `language` whose body contains `key`. */
const fencedWith = (text, language, key) =>
  [...text.matchAll(new RegExp("```" + language + "\\r?\\n([\\s\\S]*?)```", "g"))]
    .map(([, body]) => body)
    .find((body) => body.includes(key));

/**
 * The run's clock, as one block. What a worker brief carries is the deadline the block
 * derives, not the block: a worker files nothing and confirms nothing, so the margins are
 * the orchestrating run's alone. The three values
 * are a decision somebody made about how long a search may run, and two of them are
 * **margins before the deadline** rather than durations from the start: written that way
 * round, a swap reads perfectly well in prose and inverts the run, because confirmation
 * would then close before candidates stop being opened and every late candidate would be
 * unconfirmable by construction.
 *
 * So the block is the home of the numbers and this is the invariant over them. What it
 * cannot check is the one thing the skill says in prose beside it: that filing, the report
 * and the handoff all happen *after* the deadline, since a clock that could stop a
 * confirmed finding from reaching its advisory would lose work already paid for.
 *
 * Every discovery run carries its own block, because how long a search may run is a
 * decision about that kind of finding. The invariant over the numbers is not: a swap reads
 * the same in any of them.
 */
test("each discovery run's clock is one block, and its margins sit inside its window", () => {
 for (const name of DISCOVERY) {
  const skill = readFileSync(join(SOURCE, name, "SKILL.md"), "utf8");
  const block = fencedWith(skill, "yaml", "window_minutes:");
  assert.ok(block, `${name}: SKILL.md has no fenced clock block carrying window_minutes`);

  const minutes = (key) => {
    const found = new RegExp(`^${key}:[ \\t]*(\\d+)`, "m").exec(block);
    assert.ok(found, `${name}: the clock block is missing ${key}`);
    return Number(found[1]);
  };

  const window = minutes("window_minutes");
  const open = minutes("open_candidates_until");
  const confirm = minutes("confirm_until");

  assert.ok(
    open < window,
    `${name}: candidates open past the window itself (${open} of ${window})`
  );
  assert.ok(
    confirm < open,
    `${name}: confirmation stops ${confirm} minutes out and candidates open until ${open}: ` +
      "a candidate opened last could never be confirmed"
  );
  assert.ok(confirm > 0, `${name}: confirmation stops ${confirm} minutes before the deadline`);

  // And the window has one home, which is that block. The `date` command above it
  // substitutes `window_minutes` rather than restating the number, because a second copy
  // drifts in silence: a run would then compute one deadline and brief its workers with
  // the window of another, and every spec here would still pass.
  assert.ok(
    !/\+\d+ minutes/.test(skill),
    `${name}: SKILL.md hard-codes a window in its deadline command instead of substituting window_minutes`
  );
 }
});

/**
 * GitHub's severity enum, which is the whole set a `severity` field may carry. The rubric
 * is fixed so that the value on an advisory is read off a table rather than argued per
 * finding, and a rubric naming a level the API does not have is a filing call that fails
 * at the end of a run rather than at the start.
 *
 * Both directions: a level with no row is a finding with nowhere to land, and a row with
 * no level is a rubric that cannot be filed under.
 */
const SEVERITIES = ["critical", "high", "medium", "low"];

test("the severity rubric names GitHub's enum and nothing else", () => {
  const skill = readFileSync(join(AUDIT, "SKILL.md"), "utf8");

  // The rubric's own rows, taken from its header down to the end of its table rather than
  // from the whole file: any other table of backticked lowercase first cells would
  // otherwise read as severity levels and fail a spec about GitHub's enum with a sentence
  // about a table nobody meant.
  const lines = skill.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith("| severity |"));
  assert.ok(header !== -1, "SKILL.md has no severity rubric table");
  const end = lines.findIndex((line, at) => at > header && !line.startsWith("|"));
  const table = lines.slice(header, end === -1 ? undefined : end).join("\n");

  const rows = [...table.matchAll(/^\|[ \t]*`([a-z]+)`[ \t]*\|/gm)].map(([, level]) => level);
  assert.deepEqual(
    [...rows].sort(),
    [...SEVERITIES].sort(),
    `the rubric's levels are ${rows.join(", ") || "none"}`
  );

  // The floor is one of them, and the one the floor starts at is `high` by decision: a
  // floor stated as a level the rubric does not have is a floor nothing can be compared
  // against.
  // `assert.ok` over a regex rather than `assert.match` here and below: the subject is a
  // whole file, and `assert.match` prints it as the actual value, burying the sentence
  // that says what broke under the document that broke.
  assert.ok(
    /The floor is `min_severity`, and it starts at `high`/.test(unwrapped(skill)),
    "SKILL.md no longer states where the floor starts"
  );
});

/**
 * The contract between a run that writes a report and the run that is briefed from it.
 * The table is the only thing that carries forward, so its columns are an interface: a
 * renamed or reordered column is a table the next run reads wrongly or not at all, and
 * nothing else in the workspace would say so.
 *
 * `Audit-Run` is checked in both files on purpose. It is the single join between a private
 * advisory and a public-enough report row, and it only works while the advisory body
 * writes it and the table carries it: either half dropped leaves a report nobody can tie
 * to the findings it stands for, with no error anywhere.
 */
const REPORT_COLUMNS = ["hypothesis", "run (UTC)", "status", "what was researched"];
const REPORT_STATUSES = ["ruled out", "inconclusive", "below floor", "prior decision", "filed"];

test("the report contract the next run reads is still written down", () => {
  const report = readFileSync(join(AUDIT, "references", "run-report.md"), "utf8");
  const skill = readFileSync(join(AUDIT, "SKILL.md"), "utf8");

  const header = report
    .split(/\r?\n/)
    .find((line) => line.startsWith("| hypothesis"));
  assert.ok(header, "run-report.md has no table header starting with the hypothesis column");
  const columns = header.split("|").map((cell) => cell.trim());
  for (const [index, column] of REPORT_COLUMNS.entries()) {
    assert.ok(
      columns[index + 1]?.startsWith(column),
      `report column ${index + 1} is ${JSON.stringify(columns[index + 1])}, not ${column}`
    );
  }

  // The status column is read by the next run as much as by a person, so the vocabulary
  // is fixed rather than written fresh each time. Each value is checked as a table cell
  // in the vocabulary section, not merely as prose somewhere in the file.
  for (const status of REPORT_STATUSES) {
    assert.ok(
      new RegExp(`^\\|[ \\t]*\`${status}\`[ \\t]*\\|`, "m").test(report),
      `run-report.md's status vocabulary no longer offers \`${status}\``
    );
  }

  // The advisory body as the skill writes it, not the prose around it: a mention of the
  // join in a paragraph is not a line on a filed advisory, and the paragraph is what
  // survives when the template loses the field.
  const body = fencedWith(skill, "markdown", "## Impact");
  assert.ok(body, "SKILL.md has no fenced advisory body");
  assert.ok(/^Audit-Run:/m.test(body), "the advisory body no longer carries the join");
  assert.ok(
    /^Audit-Hypothesis:/m.test(body),
    "the advisory body no longer carries the attempt it came from, so a lost table cannot be rebuilt"
  );

  // And the other end of the join, which is a column of the table rather than a field.
  assert.ok(
    /The `run \(UTC\)` column is the `Audit-Run` timestamp/.test(unwrapped(report)),
    "run-report.md no longer says which column the advisories join on"
  );
});

/**
 * The audit writes in two places and neither is public: a private advisory, and a report
 * that goes back to the caller. A run that files a public issue, labels one, opens a pull
 * request or comments on anything has disclosed what the advisory route exists to keep
 * private, and prose alone would not fail anything.
 *
 * The fragments are the spellings such a mistake arrives in, not every spelling it could:
 * a `curl`, a `graphql` mutation or a script would carry none of them. What makes the
 * list worth having anyway is that `gh` is the only client these files name, so the two
 * shapes below are the two a future edit would reach for.
 */
const PUBLIC_WRITES = [
  "gh issue create",
  "gh issue comment",
  "gh issue edit",
  "gh issue close",
  "gh label create",
  "gh pr create",
  "gh pr comment",
  "gh gist create"
];

test("nothing in the audit writes anywhere public", () => {
  for (const file of auditFiles()) {
    const text = readFileSync(file, "utf8");
    for (const fragment of PUBLIC_WRITES) {
      assert.ok(
        !text.includes(fragment),
        `${relative(root, file)} names \`${fragment}\`, and an audit has nowhere public to write`
      );
    }

    // The same write through `gh api`, which no fragment above sees. This is the shape the
    // public per-run record was probed with before it was dropped, so it is the one a
    // re-added public write is likeliest to come back in.
    for (const call of callsNaming(text, "/issues")) {
      assert.ok(
        !/gh api/.test(call) || !/--method[ \t]+(POST|PATCH|PUT|DELETE)/.test(call),
        `${relative(root, file)} writes to the issues API, which is public:${call}`
      );
    }
  }
});

/**
 * The advisory listings in `text`: a `gh api` call on a repository's advisories
 * collection, which is neither a submit (`--method`, or the `reports` subpath) nor a read
 * of one advisory by id. The two specs below ask different questions of the same set, and
 * a set each recognised its own way is one they stop agreeing about: identified by the
 * query string, a listing with no query string is a listing neither of them sees.
 *
 * Both files also discuss the `state` filter in prose while leaving it off the call, which
 * is why these are checked on the calls rather than on the file.
 */
const advisoryListings = (text) =>
  callsNaming(text, "security-advisories").filter(
    (call) =>
      call.includes("gh api") &&
      // The method, not the flag: `--method GET` is a listing spelled the long way, and
      // exempting everything that names `--method` would exempt the one call a listing
      // spec is for.
      !/--method[ \t]+(POST|PATCH|PUT|DELETE)/.test(call) &&
      !/security-advisories\/(reports|\{|\$)/.test(call)
  );

/**
 * History is never filtered by state, and for advisories the filter is the only one the
 * endpoint has. An advisory is `closed` or `withdrawn` once its owner has decided it, and
 * a decision is the history a run most needs: filtered out, a declined finding reads as a
 * finding nobody has seen and gets filed again, which is the one outcome the disposition
 * table exists to prevent. `withdrawn` cannot even be asked for.
 */
test("no advisory listing filters by state", () => {
  let checked = 0;
  for (const file of auditFiles()) {
    for (const call of advisoryListings(readFileSync(file, "utf8"))) {
      assert.ok(
        !/[?&]state=/.test(call),
        `${relative(root, file)}: an advisory listing filters by state:${call}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no advisory listing left to check");
});

/**
 * The listing's page, which is the other half of reading history: `gh api` returns one
 * page by default, and a run that reads the first page of a repository's advisories draws
 * the same conclusion from a truncated answer as from a complete one.
 *
 * The credential probe is the exception, and `-i` is what distinguishes it: it exists to
 * read a response header and a status code, so what comes back in the body is not history
 * and paging through it would be the one thing the probe must not do, which is work.
 *
 * Counted, like the spec above: every listing here is either the probe or a read of
 * history, so a run with nothing left to check means the extractor stopped matching, and
 * an empty loop is the one way a spec about a flag passes on a call that dropped it.
 */
test("every advisory listing that reads history pages through it", () => {
  let checked = 0;
  for (const file of auditFiles()) {
    for (const call of advisoryListings(readFileSync(file, "utf8"))) {
      if (/\s-i\s/.test(call)) continue; // the probe: a status code, not history
      assert.ok(
        call.includes("--paginate"),
        `${relative(root, file)}: a history listing reads one page:${call}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no history listing left to check");
});

/**
 * The rows of one markdown table of `text`, by the heading its first column carries, as
 * the text of each row's first cell.
 *
 * Sliced from that header rather than read off the whole file, for the reason the severity
 * rubric is: any other table would otherwise contribute cells to a spec about this one and
 * fail it with a sentence about a table nobody meant. The cell is returned verbatim, so a
 * spec decides for itself whether a backtick or a bold marker is part of the value.
 */
const tableRows = (text, firstColumn) => {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith(`| ${firstColumn} |`));
  if (header === -1) return undefined;
  const end = lines.findIndex((line, at) => at > header && !line.startsWith("|"));
  return lines
    .slice(header + 2, end === -1 ? undefined : end)
    .map((row) => row.split("|")[1]?.trim())
    .filter((cell) => cell);
};

/**
 * The refactor run's value tiers, which do for it what the severity rubric does for the
 * audit: decide whether a candidate is filed, off a table rather than per finding. Unlike
 * severity these answer to no API, so nothing outside this spec would notice a tier
 * renamed, dropped, or quietly added to widen what a run may file.
 *
 * `cosmetic` is the load-bearing one and the reason the set is pinned in both directions.
 * It exists to be named and refused: a run under pressure to fill its cap reaches for the
 * candidate with no cost shown, and a floor can only exclude a tier the table has.
 */
const TIERS = ["structural", "recurring", "local", "cosmetic"];

test("the refactor run's tiers are the four it files against", () => {
  const skill = readFileSync(join(REFACTOR, "SKILL.md"), "utf8");

  const rows = tableRows(skill, "tier");
  assert.ok(rows, "refactor-discovery/SKILL.md has no tier table");
  assert.deepEqual(
    [...rows].sort(),
    TIERS.map((tier) => `\`${tier}\``).sort(),
    `the tiers are ${rows.join(", ") || "none"}`
  );

  // Where the floor starts, and the one place it may be moved to. A floor stated as a tier
  // the table does not have is a floor nothing can be compared against, and a floor that
  // may be lowered without a bound is the cap filling itself from `cosmetic`.
  // `assert.ok` over a regex rather than `assert.match`, as above: the subject is a whole
  // file, and `assert.match` prints it as the actual value.
  const prose = unwrapped(skill);
  assert.ok(
    /The floor is `min_tier`, and it starts at `recurring`/.test(prose),
    "refactor-discovery/SKILL.md no longer states where the floor starts"
  );
  assert.ok(
    prose.includes("only to `local`"),
    "refactor-discovery/SKILL.md no longer bounds how far the floor may be lowered"
  );
  assert.ok(
    prose.includes("`cosmetic` is never filed at any floor"),
    "refactor-discovery/SKILL.md no longer refuses `cosmetic` outright"
  );
});

/**
 * The behaviour classes, which are the whole of what this run may propose: a change
 * outside them is a feature request or a bug report wearing a refactor's clothes.
 *
 * Pinned in both directions. A class dropped narrows the run silently (losing
 * `narrowed, with a guard` would lose the deletion the caller most wants), and a class
 * added is the way a breaking change arrives looking like one of these.
 */
const BEHAVIOUR = ["none", "little, for the better", "narrowed, with a guard"];

test("the refactor run proposes only the three behaviour classes", () => {
  const skill = readFileSync(join(REFACTOR, "SKILL.md"), "utf8");
  const rows = tableRows(skill, "behaviour");
  assert.ok(rows, "refactor-discovery/SKILL.md has no behaviour table");
  assert.deepEqual(
    [...rows].sort(),
    BEHAVIOUR.map((kind) => `\`${kind}\``).sort(),
    `the behaviour classes are ${rows.join(", ") || "none"}`
  );
});

/**
 * What a finding may remove, and what it owes for each kind. Every line is candidate
 * surface by decision, so this table is the only thing standing where a category exclusion
 * would otherwise be: for code the tests that cover it, for a spec the spec that still
 * pins the rule, for a comment the home that survives.
 *
 * The spec row is why this is pinned rather than left to prose. There is no CI in this
 * repository and `npm run check` is the whole safety net, so a run rewarded for lines
 * removed is pointed straight at it. Dropping this row would not fail anything else here.
 */
const SURFACE = ["**code**", "**a spec**", "**a comment**"];

test("the refactor run owes something for every kind of line it removes", () => {
  const skill = readFileSync(join(REFACTOR, "SKILL.md"), "utf8");
  const rows = tableRows(skill, "what the finding removes");
  assert.ok(rows, "refactor-discovery/SKILL.md has no surface table");
  assert.deepEqual(
    [...rows].sort(),
    [...SURFACE].sort(),
    `the kinds of surface are ${rows.join(", ") || "none"}`
  );
});

/**
 * The refactor report's contract, which is the audit's with one column added and the
 * redaction rules gone. Its first four columns are the audit's, in the audit's order, on
 * purpose: somebody who reads both reports should read one table twice.
 *
 * `issues` is the fifth and this run's own, and it is what makes one row able to hold a
 * finding filed in four repositories. Without it the obvious thing to do with four issue
 * URLs is write four rows, and four rows is four findings against a cap of three.
 */
const REFACTOR_REPORT_COLUMNS = [
  "hypothesis",
  "run (UTC)",
  "status",
  "what was researched",
  "issues"
];

test("the refactor report's contract is still written down", () => {
  const report = readFileSync(join(REFACTOR, "references", "run-report.md"), "utf8");
  const skill = readFileSync(join(REFACTOR, "SKILL.md"), "utf8");

  const header = report.split(/\r?\n/).find((line) => line.startsWith("| hypothesis"));
  assert.ok(header, "run-report.md has no table header starting with the hypothesis column");
  const columns = header.split("|").map((cell) => cell.trim());
  for (const [index, column] of REFACTOR_REPORT_COLUMNS.entries()) {
    assert.ok(
      columns[index + 1]?.startsWith(column),
      `report column ${index + 1} is ${JSON.stringify(columns[index + 1])}, not ${column}`
    );
  }

  // The same vocabulary the audit fixes, and for the same reason: the column is read by
  // the next run as much as by a person. Checked as table cells in the vocabulary section,
  // not merely as prose somewhere in the file.
  for (const status of REPORT_STATUSES) {
    assert.ok(
      new RegExp(`^\\|[ \\t]*\`${status}\`[ \\t]*\\|`, "m").test(report),
      `run-report.md's status vocabulary no longer offers \`${status}\``
    );
  }

  // One row is one finding, which is the rule the fifth column exists to serve. Pinned in
  // the report contract rather than only in the skill, because this is the file somebody
  // writing a report has open.
  assert.ok(
    unwrapped(report).includes("One row is one finding"),
    "run-report.md no longer says a row is a finding rather than an issue"
  );

  // The only measure of whether any of this works. A run files issues and reduces nothing,
  // so a report that counts what it filed and not what was closed reads as progress on a
  // line that is still going the wrong way.
  assert.ok(
    /^Done so far:/m.test(report),
    "run-report.md no longer carries the count of what earlier findings became"
  );

  // The join, in the body the skill writes rather than in the prose around it: a mention
  // in a paragraph is not a line on a filed issue, and the paragraph is what survives when
  // the template loses the field.
  const body = fencedWith(skill, "markdown", "**What it removes.**");
  assert.ok(body, "refactor-discovery/SKILL.md has no fenced issue body");
  assert.ok(/^Refactor-Run:/m.test(body), "the issue body no longer carries the join");
  assert.ok(
    /^Refactor-Hypothesis:/m.test(body),
    "the issue body no longer carries the attempt it came from, so a lost table cannot be rebuilt"
  );
});

/**
 * The `gh issue list` calls in `text`: lines naming it **inside a fenced `bash` block**,
 * `\`-continuations rejoined.
 *
 * The fence is the discriminator, and it has to be. `callsNaming` alone is enough for the
 * audit, whose listings are found by a path (`security-advisories`) that its prose happens
 * not to repeat; here the thing being matched is the command's own name, and both files
 * discuss `gh issue list` in sentences about which flags it needs. Those sentences are
 * documentation, not calls, and a spec that fails on one is a spec nobody can satisfy
 * without deleting the explanation.
 */
const bashCalls = (text, command) =>
  [...text.matchAll(/```bash\r?\n([\s\S]*?)```/g)].flatMap(([, body]) =>
    callsNaming(body, command)
  );

const issueListings = (text) => bashCalls(text, "gh issue list");

/**
 * History is never filtered by state, a rule the workspace `AGENTS.md` states
 * under "What earlier runs and earlier people already decided".
 * For issues the default is the filtered one:
 * `gh issue list` shows open issues and says nothing about the closed ones. A closed issue
 * is the history this run most needs, because it is the only place a decision somebody
 * already made is written down. Filtered out, a declined finding reads as one nobody has
 * seen and gets filed again.
 */
test("every issue listing reads every state", () => {
  let checked = 0;
  for (const file of refactorFiles()) {
    for (const call of issueListings(readFileSync(file, "utf8"))) {
      assert.ok(
        /--state[ \t]+all/.test(call),
        `${relative(root, file)}: an issue listing does not read every state:${call}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no issue listing left to check");
});

/**
 * The other half of reading history, and this route's version of `--paginate`:
 * `gh issue list` returns thirty rows and says nothing about the rest, so a run reading
 * the default draws the same conclusion from a truncated answer as from a complete one.
 *
 * Counted, like the audit's: an empty loop is the one way a spec about a flag passes on a
 * call that dropped it.
 */
test("every issue listing reads more than one page of history", () => {
  let checked = 0;
  for (const file of refactorFiles()) {
    for (const call of issueListings(readFileSync(file, "utf8"))) {
      assert.ok(
        /--limit[ \t]+\d+/.test(call),
        `${relative(root, file)}: an issue listing reads the default thirty rows:${call}`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no issue listing left to check");
});

/**
 * The audit's "nothing writes anywhere public", inverted. This run's destination *is*
 * public, so what it must not do is reach for anything else: it files an issue and then
 * leaves every record alone, its own included, because a record that can be amended is no
 * longer the account of the run that wrote it, and closing is the owner's.
 *
 * `security-advisories` is in the list because the other direction is a real mistake too:
 * a refactor finding does not belong in the private store, and a skill written beside the
 * audit is one copy-paste from reaching it.
 *
 * The fragments are the spellings such a mistake arrives in, not every spelling it could.
 * What makes the list worth having is that `gh` is the only client these files name. The
 * reference discusses each of these as a REST endpoint deliberately, in prose, which is
 * how it documents a call this run does not make without naming the command that makes it.
 */
const REFACTOR_FORBIDDEN = [
  "gh issue close",
  "gh issue comment",
  "gh issue edit",
  "gh issue reopen",
  "gh issue delete",
  "gh label create",
  "gh pr create",
  "gh pr comment",
  "gh gist create",
  "security-advisories"
];

test("the refactor run files an issue and amends nothing", () => {
  for (const file of refactorFiles()) {
    const text = readFileSync(file, "utf8");
    for (const fragment of REFACTOR_FORBIDDEN) {
      assert.ok(
        !text.includes(fragment),
        `${relative(root, file)} names \`${fragment}\`, which a discovery run does not call`
      );
    }

    // The same writes through `gh api`, which no fragment above sees. A POST to the issues
    // collection is how a finding is filed and how the capability is probed, so it is the
    // one method allowed here, and only as the probe: `-i` is what makes it one, since the
    // probe exists to read a status code and a response header. Everything else on that
    // path edits a record that already exists.
    for (const call of callsNaming(text, "/issues")) {
      if (!/gh api/.test(call)) continue;
      assert.ok(
        !/--method[ \t]+(PATCH|PUT|DELETE)/.test(call),
        `${relative(root, file)} edits an existing issue through the API:${call}`
      );
      assert.ok(
        !/--method[ \t]+POST/.test(call) || /\s-i\s/.test(call),
        `${relative(root, file)} posts to the issues API outside the probe:${call}`
      );
    }
  }
});
