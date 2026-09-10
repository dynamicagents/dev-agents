#!/usr/bin/env node
/**
 * Bring every submodule to the tip of its declared branch — the command you run
 * after merging a PR in one of them.
 *
 * This is not `git submodule update --remote --merge`, which has a flaw that
 * bites exactly here: on a detached HEAD it merges the remote branch *into the
 * detached HEAD*, leaving you still detached, now at a commit with no name.
 * And `git submodule update` in any form checks out the *recorded* commit — a
 * commit is not a branch, so it detaches you, and the next commit you write goes
 * somewhere no branch can see. You find that out after writing it.
 *
 * So: check out the declared branch, then fast-forward it from the remote.
 *
 * ## What it refuses to touch
 *
 *   - **A submodule with uncommitted changes.** Moving a branch under a dirty
 *     tree is how you lose work you have not named yet.
 *   - **A submodule on some other branch.** You are mid-feature there. Checking
 *     out the declared branch under you loses no commits but loses your place,
 *     which a command you run for its side effect on *other* repos has no
 *     business doing.
 *
 * `--ff-only` is the rest of the safety: a branch carrying local commits, or one
 * rewritten upstream, stops with its own message rather than being merged into
 * silently.
 *
 * ## Why it does not bump the pointers
 *
 * Moving a submodule and recording where it moved to are separate decisions. The
 * pin is the combination that was green together, so it advances when you have
 * decided it should, in a commit that says so. This prints what moved and leaves
 * that to you.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { declared, git, tryGit, currentBranch, recordedCommit } from "./submodule-config.mjs";

/** Returns [path, note] per submodule. `quiet` suppresses the fetch's stderr. */
export const sync = (root) => {
  const results = [];

  for (const [, { path, branch }] of declared(root)) {
    const dir = join(root, path);

    if (!branch) {
      results.push([path, "no branch declared in .gitmodules — skipped"]);
      continue;
    }
    if (!tryGit(["rev-parse", "--git-dir"], dir)) {
      results.push([path, "not initialized — run `npm run bootstrap`"]);
      continue;
    }
    if (tryGit(["status", "--porcelain"], dir) !== "") {
      results.push([path, "uncommitted changes — skipped, commit or stash first"]);
      continue;
    }

    const on = currentBranch(dir);
    if (on !== null && on !== branch) {
      results.push([path, `on \`${on}\`, not \`${branch}\` — left alone`]);
      continue;
    }

    const before = tryGit(["rev-parse", "--short", "HEAD"], dir);

    try {
      execFileSync("git", ["fetch", "--quiet", "origin", branch], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      results.push([path, `could not fetch origin/${branch} — skipped`]);
      continue;
    }

    if (on === null) {
      // Detached, which is where `git submodule update` and a fresh clone leave you.
      if (!tryGit(["rev-parse", "--verify", "--quiet", branch], dir)) {
        try {
          git(["checkout", "-b", branch, `origin/${branch}`], dir);
        } catch {
          results.push([path, `could not create \`${branch}\` from origin/${branch} — skipped`]);
          continue;
        }
      } else {
        try {
          git(["checkout", branch], dir);
        } catch {
          results.push([path, `could not check out \`${branch}\` — skipped`]);
          continue;
        }
      }
    }

    try {
      git(["merge", "--ff-only", `origin/${branch}`], dir);
    } catch {
      results.push([
        path,
        `\`${branch}\` will not fast-forward to origin/${branch} — local commits, or rewritten upstream. ` +
          `Resolve in ${path}/ by hand.`
      ]);
      continue;
    }

    const after = tryGit(["rev-parse", "--short", "HEAD"], dir);
    const pinned = recordedCommit(root, path)?.slice(0, 7);
    const ahead = pinned && !tryGit(["rev-parse", "--short", "HEAD"], dir)?.startsWith(pinned.slice(0, 7));

    results.push([
      path,
      before === after
        ? `up to date at ${after} (${branch})${ahead ? " — ahead of the pin" : ""}`
        : `${before} → ${after} (${branch})${ahead ? " — ahead of the pin" : ""}`
    ]);
  }

  return results;
};

export const report = (results) => {
  const width = Math.max(...results.map(([p]) => p.length));
  for (const [path, note] of results) console.log(`  ${path.padEnd(width)}  ${note}`);

  const ahead = results.filter(([, n]) => n.includes("ahead of the pin"));
  if (ahead.length > 0) {
    console.log(
      `\n${ahead.length} submodule(s) are ahead of the commit this workspace records. ` +
        `\`git add\` the ones you want to advance and commit that as its own decision.`
    );
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
  report(sync(root));
}
