#!/usr/bin/env node
/**
 * The one command a fresh clone runs, and the one you re-run after merging a PR
 * in a submodule.
 *
 * `git clone --recurse-submodules` already brings the repos, and because git
 * stores symlinks verbatim `.claude/skills/` arrives working — unless the clone
 * decided this filesystem has no symlinks, in which case every link arrives as a
 * plain file naming its own target, `CLAUDE.md` included, and nothing says so.
 * Repairing that is `symlinks.mjs`, whose header has the why. What is missing
 * besides is a branch to work on and the `node_modules` trees.
 *
 * The branch half is `sync`, called rather than reimplemented: `git submodule
 * update` checks out the *recorded commit*, and a commit is not a branch, so it
 * leaves every submodule on a detached HEAD where the next commit you write goes
 * somewhere no branch can see. `sync` puts each one on its declared branch and
 * fast-forwards it, and it is careful where that would be rude — a dirty tree,
 * or a feature branch you are still working on. Its header has the rest.
 *
 * A url in `.gitmodules` does not reach a checkout that already exists. `git
 * submodule init` copied the old one into `.git/config` and into each submodule's
 * `origin`, and only `git submodule sync` moves it — so that runs first, every
 * time, and a url change self-heals for anyone who runs the one command a clone is
 * told to run. It rewrites remotes and nothing else.
 *
 * It also overwrites a remote someone re-pointed by hand, which is the reason to
 * express a transport preference as a `url.<base>.insteadOf` rewrite instead: git
 * applies that on top of whatever the remote says, so the two never fight.
 * AGENTS.md has the line.
 *
 * `npm ci` is skipped where `node_modules` already exists, which is what makes
 * this safe to re-run rather than only useful once: `npm ci` deletes the tree
 * before rebuilding it, and core's own AGENTS.md prices that at ~225 s.
 * `--force` when you do want the clean rebuild.
 */

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { declared } from "./submodule-config.mjs";
import { healWorkspace, reportHeal } from "./symlinks.mjs";
import { sync, report } from "./sync.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const run = (cmd, args, cwd = root) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}${cwd === root ? "" : `   (${cwd.replace(root + "/", "")})`}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
};

const subs = declared(root);
if (subs.size === 0) {
  console.error("No submodules declared in .gitmodules.");
  process.exit(1);
}

// First, because it is what carries a changed `.gitmodules` url into a checkout that
// already has the old one. See the header.
run("git", ["submodule", "sync", "--recursive"]);

// Only for submodules that have no checkout yet. An initialized one is left to
// `sync`, which will not detach it or move it off a feature branch in progress.
const uninitialized = [...subs.values()].filter(({ path }) => !existsSync(join(root, path, ".git")));
if (uninitialized.length > 0) {
  run("git", ["submodule", "update", "--init", "--recursive", "--", ...uninitialized.map((s) => s.path)]);
}

// After the init above, so a submodule cloned a moment ago is healed with the rest
// and none is missed for having arrived late. Before `sync`, and finishing before
// it: turning `core.symlinks` on is what makes a flattened link start reading as a
// modification, and `sync` refuses to move a submodule whose tree looks dirty.
reportHeal(healWorkspace(root));

console.log("\nSubmodules:");
report(sync(root));

const skipped = [];
for (const [, { path }] of subs) {
  const modules = join(root, path, "node_modules");
  if (!force && existsSync(modules) && readdirSync(modules).length > 0) {
    skipped.push(path);
    continue;
  }
  run("npm", ["ci"], join(root, path));
}
if (skipped.length > 0) console.log(`\nnode_modules present, install skipped: ${skipped.join(", ")} (--force to reinstall)`);

run("node", [join(root, "scripts", "skills.mjs")]);

console.log("\nReady. Launch your agent from this directory so the workspace skills and AGENTS.md load.");
