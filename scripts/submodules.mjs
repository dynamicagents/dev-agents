#!/usr/bin/env node
/**
 * The four repos are submodules, and a submodule has two independent states: the
 * pointer this repo records, and whatever is checked out in the directory. They
 * are *supposed* to differ.
 *
 * That is what this script is careful not to check. A pointer is a known-good
 * combination — the commits that were green together — not a mirror of the four
 * `main` branches. Every commit in a subrepo makes it stale by design, and
 * `npm run sync` is how you move it when you want to. A check that failed on
 * staleness would fail constantly and be disabled within a week, and it would be
 * enforcing something nobody decided.
 *
 * So this checks **structure, not currency**: whether the submodules would
 * survive a clone.
 *
 *   - Every `.gitmodules` entry has a `url` and a `branch`. The branch is not
 *     decoration: `git submodule update --remote` reads it, and without it
 *     `npm run sync` silently does nothing for that repo.
 *   - Every declared path exists and is initialized. An uninitialized submodule
 *     is an empty directory, and every tool downstream treats it as a repo with
 *     no files rather than as an error.
 *   - Every recorded pointer names a commit that exists in that submodule.
 *
 * `--pushed` is the other half and is deliberately **not** in `check`, which has
 * no network. A pointer to a commit that exists only on this machine passes every
 * local check and fails `git clone --recurse-submodules` for everyone else — the
 * one failure that breaks the thing this workspace is for, and the one that
 * cannot be seen from here without asking the remote.
 */

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GITMODULES = join(root, ".gitmodules");

const pushed = process.argv.includes("--pushed");

const git = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

if (!existsSync(GITMODULES)) {
  console.error("No .gitmodules. Nothing to verify.");
  process.exit(1);
}

/**
 * Read the declarations through `git config`, not by parsing the file: git is the
 * only thing whose interpretation of it matters.
 */
const declared = new Map();
for (const line of git(["config", "-f", ".gitmodules", "--list"]).split("\n").filter(Boolean)) {
  const [key, ...rest] = line.split("=");
  const m = key.match(/^submodule\.(.+)\.(path|url|branch)$/);
  if (m) {
    const [, name, field] = m;
    if (!declared.has(name)) declared.set(name, {});
    declared.get(name)[field] = rest.join("=");
  }
}

const problems = [];

if (declared.size === 0) problems.push(".gitmodules declares no submodules.");

for (const [name, { path, url, branch }] of [...declared].sort()) {
  if (!path) {
    problems.push(`${name}: no path in .gitmodules.`);
    continue;
  }
  if (!url) problems.push(`${name}: no url in .gitmodules.`);
  if (!branch) {
    problems.push(
      `${name}: no branch in .gitmodules — \`npm run sync\` (git submodule update --remote) will skip it silently. ` +
        `Set one with \`git config -f .gitmodules submodule.${name}.branch main\`.`
    );
  }

  const dir = join(root, path);
  if (!existsSync(join(dir, ".git"))) {
    problems.push(`${name}: ${path}/ is not an initialized submodule. Run \`git submodule update --init\`.`);
    continue;
  }

  // The pointer this repo records, read from the index rather than from a status
  // string, so a dirty working tree cannot change the answer.
  let recorded;
  try {
    recorded = git(["rev-parse", `HEAD:${path}`]);
  } catch {
    try {
      recorded = git(["ls-files", "-s", path]).split(/\s+/)[1];
    } catch {
      problems.push(`${name}: no gitlink recorded for ${path}. It is a directory, not a submodule.`);
      continue;
    }
  }
  if (!recorded) {
    problems.push(`${name}: no gitlink recorded for ${path}. It is a directory, not a submodule.`);
    continue;
  }

  try {
    git(["cat-file", "-e", `${recorded}^{commit}`], dir);
  } catch {
    problems.push(`${name}: recorded pointer ${recorded.slice(0, 8)} is not a commit in ${path}/.`);
    continue;
  }

  if (pushed) {
    const remote = url ?? "origin";
    try {
      const found = execFileSync("git", ["branch", "-r", "--contains", recorded], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }).trim();
      if (!found) {
        problems.push(
          `${name}: recorded pointer ${recorded.slice(0, 8)} is on no remote branch. ` +
            `\`git clone --recurse-submodules\` would fail for anyone but you. Push ${path}/ (${remote}).`
        );
      }
    } catch {
      problems.push(`${name}: could not ask ${path}/ which remote branches contain ${recorded.slice(0, 8)}.`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} submodule problem(s):\n`);
  for (const line of problems) console.error(`  - ${line}`);
  console.error("");
  process.exit(1);
}

console.log(
  `submodules: ${declared.size} registered and initialized${pushed ? ", every pointer on a remote branch" : ""}`
);
