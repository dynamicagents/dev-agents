#!/usr/bin/env node
/**
 * The one command a fresh clone runs, and the one you re-run after merging a PR
 * in a submodule.
 *
 * `git clone --recurse-submodules` already brings the repos, and because git
 * stores symlinks verbatim `.claude/skills/` arrives working — nothing stands
 * between a clone and an agent seeing the skills. What is missing is a branch to
 * work on and the `node_modules` trees.
 *
 * The branch half is `sync`, called rather than reimplemented: `git submodule
 * update` checks out the *recorded commit*, and a commit is not a branch, so it
 * leaves every submodule on a detached HEAD where the next commit you write goes
 * somewhere no branch can see. `sync` puts each one on its declared branch and
 * fast-forwards it, and it is careful about the two cases where that would be
 * rude — a dirty tree, or a submodule you have checked out onto a feature
 * branch. Its header has the rest.
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

// Only for submodules that have no checkout yet. An initialized one is left to
// `sync`, which will not detach it or move it off a feature branch.
const uninitialized = [...subs.values()].filter(({ path }) => !existsSync(join(root, path, ".git")));
if (uninitialized.length > 0) {
  run("git", ["submodule", "update", "--init", "--recursive", "--", ...uninitialized.map((s) => s.path)]);
}

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
