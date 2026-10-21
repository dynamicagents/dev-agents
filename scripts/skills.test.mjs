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
const DISCOVERY = ["security-audit-discovery"];
const AUDIT = join(SOURCE, "security-audit-discovery");

/**
 * The audit's own markdown: the skill and everything it points at. Several specs below
 * read the whole set, because a rule the skill states and a reference file restates is a
 * rule either file can break.
 */
const auditFiles = () =>
  readdirSync(AUDIT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name));

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
 * files private advisories and a public record, and a model reading "security" in a
 * prompt must not be able to start one. `disable-model-invocation` is the field that
 * makes that structural, and it costs nothing at the naming end: the CLI still loads a
 * skill that sets it, and a `/<name>` line still selects it.
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

const GUARDRAILS = [
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

/** One `## ` section of a markdown file, by heading, without the headings after it. */
const section = (text, heading) => {
  const from = text.indexOf(`## ${heading}\n`);
  if (from === -1) return undefined;
  const rest = text.slice(from);
  const next = rest.slice(1).search(/\n## [^#]/);
  return next === -1 ? rest : rest.slice(0, next + 1);
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

test("the security-audit-discovery guardrail block is intact", () => {
  const text = readFileSync(join(AUDIT, "SKILL.md"), "utf8");
  const block = /<!-- guardrail:start -->([\s\S]*?)<!-- guardrail:end -->/.exec(text);
  assert.ok(block, "security-audit-discovery/SKILL.md has no guardrail block");
  const rules = unwrapped(block[1]);
  for (const phrase of GUARDRAILS) {
    assert.ok(rules.includes(phrase), `guardrail block no longer says: ${phrase}`);
  }
});


/** The fenced block of `text` in `language` whose body contains `key`. */
const fencedWith = (text, language, key) =>
  [...text.matchAll(new RegExp("```" + language + "\\r?\\n([\\s\\S]*?)```", "g"))]
    .map(([, body]) => body)
    .find((body) => body.includes(key));

/**
 * The run's clock, as the block the skill and every worker brief share. The three values
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
 */
test("the audit's clock is one block, and its margins sit inside its window", () => {
  const skill = readFileSync(join(AUDIT, "SKILL.md"), "utf8");
  const block = fencedWith(skill, "yaml", "window_minutes:");
  assert.ok(block, "SKILL.md has no fenced clock block carrying window_minutes");

  const minutes = (key) => {
    const found = new RegExp(`^${key}:[ \\t]*(\\d+)`, "m").exec(block);
    assert.ok(found, `the clock block is missing ${key}`);
    return Number(found[1]);
  };

  const window = minutes("window_minutes");
  const open = minutes("open_candidates_until");
  const confirm = minutes("confirm_until");

  assert.ok(open < window, `candidates open past the window itself (${open} of ${window})`);
  assert.ok(
    confirm < open,
    `confirmation stops ${confirm} minutes out and candidates open until ${open}: ` +
      "a candidate opened last could never be confirmed"
  );
  assert.ok(confirm > 0, `confirmation stops ${confirm} minutes before the deadline`);
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
  const rows = [...skill.matchAll(/^\|[ \t]*`([a-z]+)`[ \t]*\|/gm)].map(([, level]) => level);
  assert.deepEqual(
    [...rows].sort(),
    [...SEVERITIES].sort(),
    `the rubric's levels are ${rows.join(", ") || "none"}`
  );

  // The floor is one of them, and the one the floor starts at is `high` by decision: a
  // floor stated as a level the rubric does not have is a floor nothing can be compared
  // against.
  assert.match(
    unwrapped(skill),
    /The floor is `min_severity`, and it starts at `high`/,
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
    assert.match(
      report,
      new RegExp(`^\\|[ \\t]*\`${status}\`[ \\t]*\\|`, "m"),
      `run-report.md's status vocabulary no longer offers \`${status}\``
    );
  }

  // The advisory body as the skill writes it, not the prose around it: a mention of the
  // join in a paragraph is not a line on a filed advisory, and the paragraph is what
  // survives when the template loses the field.
  const body = fencedWith(skill, "markdown", "## Impact");
  assert.ok(body, "SKILL.md has no fenced advisory body");
  assert.match(body, /^Audit-Run:/m, "the advisory body no longer carries the join");
  assert.match(
    body,
    /^Audit-Hypothesis:/m,
    "the advisory body no longer carries the attempt it came from, so a lost table cannot be rebuilt"
  );

  // And the other end of the join, which is a column of the table rather than a field.
  assert.match(
    unwrapped(report),
    /The `run \(UTC\)` column is the `Audit-Run` timestamp/,
    "run-report.md no longer says which column the advisories join on"
  );
});

/**
 * The audit writes in two places and neither is public: a private advisory, and a report
 * that goes back to the caller. Every public write path is therefore a mistake with a
 * shape, which makes this the one guardrail a spec can hold completely.
 *
 * The fragments are what such a mistake would be written as. A run that files a public
 * issue, labels one, opens a pull request or comments on anything has disclosed what the
 * advisory route exists to keep private, and prose alone would not fail anything.
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
  }
});

/**
 * History is never filtered by state, and for advisories the filter is the only one the
 * endpoint has. An advisory is `closed` or `withdrawn` once its owner has decided it, and
 * a decision is the history a run most needs: filtered out, a declined finding reads as a
 * finding nobody has seen and gets filed again, which is the one outcome the disposition
 * table exists to prevent. `withdrawn` cannot even be asked for.
 *
 * Checked on the calls rather than on the file, because both files discuss the filter in
 * prose while leaving it off the call, which is the point.
 */
test("no advisory listing filters by state", () => {
  let checked = 0;
  for (const file of auditFiles()) {
    const text = readFileSync(file, "utf8");
    for (const call of callsNaming(text, "security-advisories")) {
      if (!call.includes("gh api") || call.includes("--method")) continue;
      if (/security-advisories\/(reports|\{|\$)/.test(call)) continue; // not a listing
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
 */
test("every advisory listing that reads history pages through it", () => {
  for (const file of auditFiles()) {
    const text = readFileSync(file, "utf8");
    for (const call of callsNaming(text, "security-advisories?")) {
      if (!call.includes("gh api") || /\s-i\s/.test(call)) continue;
      assert.ok(
        call.includes("--paginate"),
        `${relative(root, file)}: a history listing reads one page:${call}`
      );
    }
  }
});
