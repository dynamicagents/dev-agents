/**
 * Put the symlinks back when a clone flattened them.
 *
 * `CLAUDE.md -> AGENTS.md`, and every entry in `.claude/skills/`, is a symlink,
 * and git stores one verbatim: mode 120000, and a blob whose entire content is
 * the target path. That is the portability guarantee `skills.mjs` describes — the
 * link text is committed, so a clone is supposed to bring working links.
 *
 * Except when it does not. git probes for symlink support the first time it
 * writes a working tree, and a probe that fails — Windows without developer mode,
 * some container and network filesystems, a mount that was read-only for the
 * second git looked — writes `core.symlinks=false` into that repo's **local**
 * config. From then on git checks a symlink out as a plain file containing the
 * target path as text, and considers that correct: `git status` stays clean,
 * because under `core.symlinks=false` the text file *is* how a symlink is spelled
 * here. Nothing complains, and the probe's verdict outlives whatever made it
 * fail — the config is written once and re-read forever.
 *
 * What that costs:
 *
 *   - **`CLAUDE.md` stops being instructions.** It becomes a nine-byte file
 *     reading `AGENTS.md`. An agent loads it, finds a filename where the
 *     conventions should have been, and proceeds without them. Nothing reports
 *     this, because from git's side nothing is wrong.
 *   - **`npm run check` fails**, in the one way `skills.mjs` will not fix on its
 *     own: every skill link reported as "a real file, not a link", each with
 *     instructions to sort it out by hand.
 *
 * So `bootstrap` and `sync` both run this, and it does two things per repo — the
 * superproject and every submodule with a checkout, because each has its own
 * config and so its own copy of the problem:
 *
 *   1. Overrule the stale probe with `core.symlinks=true`, after checking that
 *      this filesystem really can make a symlink. The whole failure is a probe
 *      that was wrong, so this cannot take git's word for it — and must not take
 *      its own word either: forcing the config where symlinks genuinely do not
 *      work trades a quiet mess for a checkout that fails outright.
 *   2. Re-materialize what the old setting already flattened, which step 1 does
 *      not do on its own. The config governs the *next* checkout, and for a file
 *      already on disk and considered clean there is never a next one.
 *
 * Step 2 restores **only** a regular file whose bytes are exactly the target
 * path — the thing git itself wrote. Anything else living at that path, however
 * similar it looks, is somebody's data: it is reported and left where it is. A
 * `git checkout --` is not undoable and a symlink is one line, and the asymmetry
 * says which way to err.
 *
 * On a healthy checkout this reads the index, finds every link already a link,
 * and says nothing.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { declared, git, tryGit } from "./submodule-config.mjs";

/** The symlinks `dir` tracks: `{ path, target }` each, read from the index rather than from disk. */
const trackedLinks = (dir) => {
  // `-z`, because a path with a newline or a quote in it is one git would quote,
  // and the quoting is not worth parsing to find out it never happens.
  const listing = tryGit(["ls-files", "-s", "-z"], dir);
  if (!listing) return [];

  return listing
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [meta, path] = record.split("\t");
      const [mode, object] = meta.split(" ");
      return { mode, object, path };
    })
    .filter(({ mode }) => mode === "120000")
    .map(({ object, path }) => ({
      path,
      // Bytes, not text: this gets compared against a file on disk, and `git`'s
      // trim() would make two targets that differ by a space compare equal.
      target: execFileSync("git", ["cat-file", "blob", object], { cwd: dir })
    }));
};

/**
 * Whether this filesystem can really make a symlink. git's own probe, the one
 * that wrote `core.symlinks=false`, is the failure being repaired, so its answer
 * is the one answer unavailable here — and the replacement has to be a real
 * attempt rather than an assumption, for the reason in the header. Probed inside
 * the git directory: writable, outside the working tree, and removed either way.
 */
const symlinksWork = (dir) => {
  const gitDir = tryGit(["rev-parse", "--absolute-git-dir"], dir);
  if (!gitDir) return false;

  const probe = join(gitDir, `symlink-probe-${process.pid}`);
  try {
    unlinkSync(probe);
  } catch {
    // Nothing left behind by a run that died between the two lines below.
  }
  try {
    symlinkSync("probe", probe);
    return lstatSync(probe).isSymbolicLink();
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      // Never created.
    }
  }
};

/**
 * One repo: fix the config if it is not already right, then restore the links it
 * flattened while it was wrong. Returns `{ label, note, warnings }`, where a null
 * note means there was nothing to do.
 */
export const heal = (dir, label) => {
  const warnings = [];

  // `.git` rather than `rev-parse`, which from an uninitialized submodule's empty
  // directory walks up and answers for the superproject instead.
  if (!existsSync(join(dir, ".git"))) return { label, note: null, warnings };

  // The effective value, so a `true` inherited from global config is left to stand.
  // Writing goes to local config, which is where the bad value is.
  const already = tryGit(["config", "--get", "core.symlinks"], dir) === "true";
  if (!already) {
    if (!symlinksWork(dir)) {
      warnings.push(
        `${label}: \`core.symlinks\` is off and this filesystem cannot create one, so the links stay as text ` +
          `files. On Windows that is Developer Mode (or an elevated shell); elsewhere it is the mount. Until ` +
          `then \`CLAUDE.md\` is the nine characters \`AGENTS.md\` and \`npm run check\` will fail.`
      );
      return { label, note: "filesystem has no symlinks — left alone", warnings };
    }
    git(["config", "core.symlinks", "true"], dir);
  }

  const restore = [];
  for (const { path, target } of trackedLinks(dir)) {
    const full = join(dir, path);

    let stat = null;
    try {
      stat = lstatSync(full);
    } catch {
      // Deleted. git already reports that, and undoing it is a different decision.
    }
    if (stat === null || stat.isSymbolicLink()) continue;

    if (!stat.isFile()) {
      warnings.push(
        `${label}: \`${path}\` is a ${stat.isDirectory() ? "directory" : "special file"} where a symlink belongs. ` +
          `That is not something a flattened link looks like — left alone.`
      );
      continue;
    }
    // Size first, so a large file that merely shares a prefix is never read whole.
    if (stat.size !== target.length || !readFileSync(full).equals(target)) {
      warnings.push(
        `${label}: \`${path}\` is a regular file and its content is not \`${target.toString()}\`, so it is not a ` +
          `flattened link — left alone. Move anything you want out of it, delete it, and re-run.`
      );
      continue;
    }
    restore.push(path);
  }

  // One checkout for all of them. The index already holds the mode and the target,
  // so this is only git writing the link it should have written the first time.
  if (restore.length > 0) git(["checkout", "--", ...restore], dir);

  const note =
    restore.length > 0
      ? `${restore.length} link(s) re-materialized${already ? "" : ", core.symlinks set"}`
      : already
        ? null
        : "core.symlinks set";

  return { label, note, warnings };
};

/**
 * This repo and every submodule that has a checkout, in declaration order. A
 * submodule with none is skipped silently — `bootstrap` heals after initializing
 * them, and `sync` reports an uninitialized one itself.
 */
export const healWorkspace = (root) => [
  heal(root, "."),
  ...[...declared(root).values()].map(({ path }) => heal(join(root, path), path))
];

/** Prints only what happened. A healthy workspace gets no output at all. */
export const reportHeal = (results) => {
  const notable = results.filter(({ note }) => note !== null);
  if (notable.length > 0) {
    console.log("\nSymlinks:");
    const width = Math.max(...notable.map(({ label }) => label.length));
    for (const { label, note } of notable) console.log(`  ${label.padEnd(width)}  ${note}`);
  }

  const warnings = results.flatMap(({ warnings }) => warnings);
  if (warnings.length > 0) {
    console.error(`\n${warnings.length} path(s) where a symlink belongs, left alone:\n`);
    for (const line of warnings) console.error(`  - ${line}`);
    console.error("");
  }
};
