#!/usr/bin/env node
/**
 * Write the devkit into the repositories that run it, and check that the copies
 * this workspace **records** are the ones this source would write.
 *
 * ```sh
 * npm run devkit:sync                     # refresh every enrolled submodule
 * npm run devkit:sync -- --enroll core    # write a first copy into one
 * npm run devkit:check                    # the recorded copies match the source
 * ```
 *
 * **Enrollment is the presence of a copy, and only `--enroll` creates one.** A
 * plain sync writes into every submodule that already carries
 * `.devkit/manifest.json` and silently adds nobody, because which repositories
 * run these checkers is a fact those repositories carry: each one names the
 * scripts in its own `package.json`, and a list here would be a second home for
 * it that drifts. Leaving is the same act in reverse, in that repository's own
 * pull request.
 *
 * **`--check` reads the index on both sides, and no working tree.** A submodule
 * checkout is routinely ahead of or behind the pointer this workspace records,
 * by design — a pointer is a known-good combination and every commit in a
 * submodule makes it stale — so comparing against what happens to be checked
 * out would be red for reasons that are not defects. The source side is read
 * from the index for the matching reason: both sides are then what the next
 * commit here would record, so an unstaged edit to the source is not a finding
 * and a commit of something unrelated is never blocked.
 *
 * What follows from that: **a sync does not make `--check` pass.** The copy has
 * to be committed in its own repository and its gitlink staged here, which is
 * the whole invariant. dev-agents' `AGENTS.md`, under "The devkit", has the
 * route that keeps that window on a branch.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  declared,
  recordedCommit
} from "../../.agents/skills/superproject/scripts/submodule-config.mjs";
import { help, workspaceRoot } from "../../.agents/skills/superproject/scripts/workspace.mjs";
import {
  MANIFEST_FILE,
  describeDifferences,
  differences,
  fileDigest,
  filesUnder,
  hashDirectory,
  manifestText,
  treeDigest
} from "./src/lib/hash.mjs";

help(`
Usage: node packages/devkit/sync.mjs [--check] [--enroll <repo>…]

Write packages/devkit/src into each enrolled submodule's .devkit/, or check that
the copies this workspace records match that source. Run from the workspace root,
which is what \`npm run devkit:sync\` and \`npm run devkit:check\` do.

  --check            compare the recorded copies with the recorded source, change nothing
  --enroll <repo>…   write a first copy into a submodule that has none
`);

/** The directory a copy lives in, inside the repository that carries it. */
const COPY_DIR = ".devkit";

/** Everything under here is vendored, and nothing else in this package is. */
const SOURCE_DIR = "src";

const root = workspaceRoot();
const sourceDir = path.join(import.meta.dirname, SOURCE_DIR);
const sourcePrefix = path
  .relative(root, sourceDir)
  .split(path.sep)
  .join("/");

const args = process.argv.slice(2);
const checking = args.includes("--check");

// A name is only ever read after `--enroll`, and a stray one is an error rather
// than an enrollment: writing a first copy is the deliberate act this flag is,
// and a typo that silently enrolled a repository would be the opposite of it.
const flagAt = args.indexOf("--enroll");
const names = (from) => from.filter((arg) => !arg.startsWith("--"));
const enrolling = flagAt === -1 ? [] : names(args.slice(flagAt + 1));
const stray = names(flagAt === -1 ? args : args.slice(0, flagAt));
if (stray.length > 0) {
  console.error(
    `${stray.join(", ")}: a submodule name is only read after \`--enroll\`. ` +
      `A plain sync refreshes every submodule that already carries a copy.`
  );
  process.exit(1);
}
if (flagAt !== -1 && enrolling.length === 0) {
  console.error("--enroll needs at least one submodule name.");
  process.exit(1);
}

const submodules = declared(root);

// --- git, as plumbing -------------------------------------------------------

const git = (cwd, gitArgs, options = {}) =>
  execFileSync("git", gitArgs, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });

/**
 * `{ mode, oid, path }` for every entry a `-z` listing names.
 *
 * Both listings this reads are NUL-terminated, because a `\n` is legal in a path
 * and the escaping git falls back to otherwise would have to be undone here.
 * `oidAt` is which field of the metadata carries the object: `ls-files -s` writes
 * `<mode> <oid> <stage>` and `ls-tree` writes `<mode> <type> <oid>`, so reading
 * one with the other's shape silently hashes the stage number.
 */
const parseListing = (stdout, { oidAt }) =>
  stdout
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [meta, file] = record.split("\t");
      const parts = meta.split(" ");
      return { mode: parts[0], oid: parts[oidAt], path: file };
    });

/** `ls-files -s`: `<mode> <oid> <stage>`. */
const LS_FILES = { oidAt: 1 };

/** `ls-tree`: `<mode> <type> <oid>`. */
const LS_TREE = { oidAt: 2 };

/** The bytes of every object named, read in one `cat-file` rather than one each. */
function blobs(cwd, oids) {
  if (oids.length === 0) return new Map();
  // No `encoding`, so stdout arrives as a Buffer: a blob is bytes, and the
  // digest is taken over them. `input` is a Buffer for the same reason it has
  // to be here rather than a string: `execFileSync` decodes `input` with
  // `encoding`, and there is no encoding that means "none" for it.
  const stdout = git(cwd, ["cat-file", "--batch"], {
    input: Buffer.from(`${[...new Set(oids)].join("\n")}\n`)
  });
  const found = new Map();
  let at = 0;
  while (at < stdout.length) {
    const end = stdout.indexOf("\n", at);
    if (end === -1) break;
    const [oid, type, size] = stdout
      .subarray(at, end)
      .toString("utf8")
      .split(" ");
    if (type !== "blob")
      throw new Error(`git cat-file answered "${type}" for ${oid}`);
    const from = end + 1;
    const length = Number(size);
    found.set(oid, stdout.subarray(from, from + length));
    at = from + length + 1;
  }
  return found;
}

/** A file set as digests, from a `-z` listing and the blobs behind it. */
function digestsOf(cwd, entries, strip) {
  for (const entry of entries)
    if (entry.mode !== "100644" && entry.mode !== "100755")
      throw new Error(
        `${entry.path} is recorded with mode ${entry.mode}. A devkit copy is ` +
          `regular files only.`
      );
  const bytes = blobs(
    cwd,
    entries.map((entry) => entry.oid)
  );
  const files = {};
  for (const entry of entries) {
    const name = strip ? entry.path.slice(strip.length) : entry.path;
    files[name] = fileDigest(bytes.get(entry.oid));
  }
  return { files, tree: treeDigest(files) };
}

// --- the source, from the index and from the working tree -------------------

const sourceInIndex = () =>
  digestsOf(
    root,
    parseListing(
      git(root, ["ls-files", "-s", "-z", "--", sourcePrefix], {
        encoding: "utf8"
      }),
      LS_FILES
    ),
    `${sourcePrefix}/`
  );

const sourceInWorkTree = () => hashDirectory(sourceDir);

// --- a copy, at the commit this workspace records ---------------------------

/** Why a recorded copy could not be read at all. Each names its own fix. */
class Unreadable extends Error {}

function copyAtRecordedCommit(dir, sha) {
  if (!existsSync(path.join(dir, ".git")))
    throw new Unreadable(
      `is not initialized, so the commit this workspace records cannot be ` +
        `read. Run \`npm run bootstrap\`.`
    );
  try {
    git(dir, ["cat-file", "-e", `${sha}^{commit}`], { encoding: "utf8" });
  } catch {
    throw new Unreadable(
      `does not have ${sha.slice(0, 12)}, the commit this workspace records, ` +
        `so the copy in it cannot be read. Run \`git -C ${path.basename(dir)} ` +
        `fetch origin ${sha}\`. A pointer nobody can fetch also breaks ` +
        `\`git clone --recurse-submodules\` for everyone else.`
    );
  }

  const entries = parseListing(
    git(dir, ["ls-tree", "-r", "-z", sha, "--", COPY_DIR], {
      encoding: "utf8"
    }),
    LS_TREE
  );
  if (entries.length === 0) return { enrolled: false };

  const { files, tree } = digestsOf(dir, entries, `${COPY_DIR}/`);
  if (!Object.hasOwn(files, MANIFEST_FILE))
    throw new Unreadable(
      `records a ${COPY_DIR}/ with no ${MANIFEST_FILE} in it, so the copy ` +
        `describes nothing. Run \`npm run devkit:sync\` and commit the result ` +
        `there.`
    );

  const manifestOid = entries.find(
    (entry) => entry.path === `${COPY_DIR}/${MANIFEST_FILE}`
  ).oid;
  const text = blobs(dir, [manifestOid]).get(manifestOid).toString("utf8");
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Unreadable(
      `records a ${COPY_DIR}/${MANIFEST_FILE} that is not valid JSON: ` +
        error.message
    );
  }

  // The manifest is a claim about the files beside it, so it is checked against
  // them rather than trusted: a copy edited without a sync would otherwise pass
  // here on the strength of its own description.
  delete files[MANIFEST_FILE];
  return {
    enrolled: true,
    recorded: { files, tree: treeDigest(files) },
    manifest
  };
}

// --- writing a copy ---------------------------------------------------------

function writeCopy(dir) {
  const target = path.join(dir, COPY_DIR);
  const wanted = filesUnder(sourceDir);
  const changed = [];
  const removed = [];

  for (const file of wanted) {
    const from = path.join(sourceDir, ...file.split("/"));
    const to = path.join(target, ...file.split("/"));
    const bytes = readFileSync(from);
    if (existsSync(to) && readFileSync(to).equals(bytes)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, bytes);
    changed.push(file);
  }

  // A file the source no longer has goes, so a rename cannot leave a stale
  // module behind that something still imports.
  const keep = new Set([...wanted, MANIFEST_FILE]);
  for (const file of filesUnder(target)) {
    if (keep.has(file)) continue;
    rmSync(path.join(target, ...file.split("/")));
    removed.push(file);
  }

  // Written after the walk and never one of the files it names, so it cannot
  // hash itself.
  const text = manifestText(hashDirectory(sourceDir));
  const manifestPath = path.join(target, MANIFEST_FILE);
  const manifestChanged =
    !existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== text;
  if (manifestChanged) writeFileSync(manifestPath, text);

  return { changed, removed, manifestChanged };
}

// --- the two commands -------------------------------------------------------

const enrolled = (dir) =>
  existsSync(path.join(dir, COPY_DIR, MANIFEST_FILE));

if (checking) {
  const indexed = sourceInIndex();
  const working = sourceInWorkTree();
  if (indexed.tree !== working.tree)
    console.log(
      `note: ${sourcePrefix} has changes the index does not record. This reads ` +
        `the index, which is what a commit here would carry.`
    );

  const problems = [];
  const lines = [];
  let anyEnrolled = false;

  for (const [name, { path: relativePath }] of submodules) {
    const dir = path.join(root, relativePath);
    const sha = recordedCommit(root, relativePath);
    if (sha === null) {
      lines.push(`  ${name.padEnd(22)} ✘ no gitlink in the index`);
      problems.push(
        `${name}: \`.gitmodules\` declares ${relativePath}, but the index ` +
          `records no submodule commit there, so there is nothing to check ` +
          `against. \`npm run submodules:check\` says more.`
      );
      continue;
    }

    let copy;
    try {
      copy = copyAtRecordedCommit(dir, sha);
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
      lines.push(`  ${name.padEnd(22)} ✘ unreadable`);
      problems.push(`${name} ${error.message}`);
      continue;
    }

    if (!copy.enrolled) {
      if (enrolled(dir)) {
        lines.push(`  ${name.padEnd(22)} ✘ enrolled here, not recorded`);
        problems.push(
          `${name}: your checkout carries a ${COPY_DIR}/ that the commit this ` +
            `workspace records does not. Commit it in ${name}, push, and stage ` +
            `the gitlink here, or remove the copy.`
        );
      } else {
        lines.push(`  ${name.padEnd(22)} – not enrolled`);
      }
      continue;
    }

    anyEnrolled = true;
    const detail = describeDifferences(
      differences(indexed.files, copy.recorded.files)
    );
    if (detail !== null || copy.recorded.tree !== indexed.tree) {
      lines.push(`  ${name.padEnd(22)} ✘ does not match the source`);
      problems.push(
        `${name}: the recorded copy is not what this source would write — ` +
          (detail ?? "the files match one by one but the tree digest does not") +
          `. Run \`npm run devkit:sync\`, commit the copy in ${name}, and stage ` +
          `the gitlink here.`
      );
      continue;
    }

    const claimed = describeDifferences(
      differences(copy.manifest.files ?? {}, copy.recorded.files)
    );
    if (claimed !== null || copy.manifest.tree !== copy.recorded.tree) {
      lines.push(`  ${name.padEnd(22)} ✘ manifest does not describe its files`);
      problems.push(
        `${name}: the recorded ${COPY_DIR}/${MANIFEST_FILE} does not describe ` +
          `the files recorded beside it — ` +
          (claimed ?? "the files match one by one but the tree digest does not") +
          `. The copy was edited without a sync.`
      );
      continue;
    }

    lines.push(`  ${name.padEnd(22)} ✓ matches`);
  }

  if (Object.keys(indexed.files).length === 0 && anyEnrolled)
    problems.push(
      `the index records no files under ${sourcePrefix}, so there is no source ` +
        `for the recorded copies to match. Stage the devkit source here.`
    );

  console.log(lines.join("\n"));

  if (problems.length > 0) {
    console.error(`\n✘ the devkit copies this workspace records are not the source:\n`);
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error("");
    process.exit(1);
  }

  console.log(
    anyEnrolled
      ? "✓ every recorded devkit copy matches the recorded source."
      : "✓ no submodule records a devkit copy, and none is claimed."
  );
  process.exit(0);
}

// --- write mode -------------------------------------------------------------

for (const name of enrolling) {
  const entry = submodules.get(name);
  if (!entry) {
    console.error(
      `${name} is not a submodule of this workspace. \`.gitmodules\` declares: ` +
        `${[...submodules.keys()].join(", ")}.`
    );
    process.exit(1);
  }
  if (enrolled(path.join(root, entry.path))) {
    console.error(
      `${name} already carries a ${COPY_DIR}/, so it is already enrolled. ` +
        `A plain \`npm run devkit:sync\` refreshes it.`
    );
    process.exit(1);
  }
}

const targets = [...submodules].filter(
  ([name, { path: relativePath }]) =>
    enrolling.includes(name) || enrolled(path.join(root, relativePath))
);

if (targets.length === 0) {
  console.log(
    `No submodule carries a ${COPY_DIR}/ yet. ` +
      `\`npm run devkit:sync -- --enroll <repo>\` writes a first copy.`
  );
  process.exit(0);
}

for (const [name, { path: relativePath }] of targets) {
  const dir = path.join(root, relativePath);
  if (!existsSync(path.join(dir, "package.json")))
    throw new Error(
      `${name} is enrolled but its checkout is empty, so there is nowhere to ` +
        `write. Run \`npm run bootstrap\`.`
    );

  const first = enrolling.includes(name);
  const { changed, removed, manifestChanged } = writeCopy(dir);
  const moved = changed.length + removed.length;

  if (first) {
    console.log(`${name}: wrote a first ${COPY_DIR}/ (${moved} files).`);
    console.log(
      `  Next, in ${name}: point its scripts at \`node ${COPY_DIR}/<name>.mjs\`, ` +
        `add \`npm run devkit:verify\` to its \`check\`, and add \`${COPY_DIR}/\` ` +
        `to its \`.prettierignore\` so \`npm run format\` cannot rewrite the copy.`
    );
  } else if (moved === 0 && !manifestChanged) {
    console.log(`${name}: unchanged.`);
  } else {
    console.log(
      `${name}: ${changed.length} written, ${removed.length} removed` +
        (manifestChanged ? `, ${MANIFEST_FILE} rewritten` : "") +
        "."
    );
  }
}

console.log(
  `\nThe copies are written. \`npm run devkit:check\` passes once each one is ` +
    `committed in its own repository and its gitlink is staged here.`
);
