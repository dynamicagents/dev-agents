#!/usr/bin/env node
/**
 * The one command a fresh clone runs.
 *
 * `git clone --recurse-submodules` already brings the four repos and, because git
 * stores symlinks verbatim, `.claude/skills/` arrives working — there is no setup
 * step standing between a clone and Claude seeing the skills. What is missing is
 * the four `node_modules` trees, and this is what installs them.
 *
 * Installs are **skipped where `node_modules` already exists**, which is what
 * makes this safe to run on a working checkout rather than only on a fresh one.
 * `npm ci` deletes the tree before rebuilding it, and core's own AGENTS.md prices
 * that at ~225 s; four of those is a long wait to reach a state you already had.
 * `--force` when you do want the clean rebuild.
 */

import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const run = (cmd, args, cwd = root) => {
  console.log(`\n$ ${cmd} ${args.join(" ")}${cwd === root ? "" : `   (in ${cwd.replace(root + "/", "")})`}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
};

run("git", ["submodule", "update", "--init", "--recursive"]);

const paths = execFileSync("git", ["config", "-f", ".gitmodules", "--get-regexp", "path"], {
  cwd: root,
  encoding: "utf8"
})
  .trim()
  .split("\n")
  .map((l) => l.split(" ")[1])
  .sort();

for (const p of paths) {
  const dir = join(root, p);
  if (!force && existsSync(join(dir, "node_modules")) && readdirSync(join(dir, "node_modules")).length > 0) {
    console.log(`\n${p}: node_modules present, skipping install (--force to reinstall)`);
    continue;
  }
  run("npm", ["ci"], dir);
}

run("node", [join(root, "scripts", "skills.mjs")]);

console.log("\nReady. Launch Claude from this directory so the workspace skills and AGENTS.md load.");
