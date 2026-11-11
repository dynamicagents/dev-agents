/**
 * `devkit:check`: every row of the verdict table, through real git.
 *
 * The check's whole subject is what a workspace **records** — a gitlink in the
 * index, and the tree behind it — so the fixtures here are real repositories
 * with real submodules rather than a fake reader. A fake would pin the parser
 * and leave the question the check exists to answer untested: which of the
 * several commits a submodule has at any moment this workspace is pointing at.
 *
 * `helpers.mjs` passes `protocol.file.allow=always` to every git invocation,
 * which a submodule whose url is a local path needs.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import {
  declared,
  recordedCommit
} from "../../../.agents/skills/superproject/scripts/submodule-config.mjs";
import {
  help,
  workspaceRoot
} from "../../../.agents/skills/superproject/scripts/workspace.mjs";
import { MANIFEST_FILE } from "../src/lib/hash.mjs";
import { git, node, workspaces, write } from "./helpers.mjs";

const { make, clean } = workspaces();
afterEach(clean);

const sync = (root, ...args) =>
  node(root, ["packages/devkit/sync.mjs", ...args]);
const check = (root) => sync(root, "--check");

/** Commit whatever is in a submodule's tree, and stage the gitlink here. */
function record(ws, name, message = "the devkit copy") {
  git(ws.path(name), ["add", "-A"]);
  git(ws.path(name), ["commit", "-m", message]);
  git(ws.root, ["add", name]);
}

/** A workspace whose `core` carries a copy that its index records. */
function recorded({ submodules = ["core"] } = {}) {
  const ws = make({ submodules });
  const run = sync(ws.root, "--enroll", "core");
  assert.equal(run.status, 0, run.stderr);
  record(ws, "core");
  return ws;
}

describe("a recorded copy", () => {
  it("passes when it is what the source would write", () => {
    const ws = recorded();

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /core\s+✓ matches/);
    assert.match(run.stdout, /every recorded devkit copy matches/);
  });

  it("fails when the recorded copy is not that source", () => {
    const ws = recorded();
    appendFileSync(
      path.join(ws.root, "packages/devkit/src/lib/hash.mjs"),
      "\n// a source change\n"
    );
    git(ws.root, ["add", "packages/devkit/src"]);

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /differs: lib\/hash\.mjs/);
    assert.match(run.stderr, /commit the copy in core, and stage the gitlink/);
  });

  it("fails when a copy was edited and committed", () => {
    const ws = recorded();
    appendFileSync(
      path.join(ws.path("core"), ".devkit/lib/hash.mjs"),
      "\n// edited in the copy\n"
    );
    record(ws, "core", "edit the copy by hand");

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /is not what this source would write/);
  });

  it("fails when the manifest alone was edited to match", () => {
    // The manifest is a claim, so it is checked against the files recorded with
    // it rather than trusted: a copy whose manifest was brought into line by
    // hand would otherwise pass on the strength of its own description.
    const ws = recorded();
    writeFileSync(
      path.join(ws.path("core"), ".devkit", MANIFEST_FILE),
      '{\n  "tree": "0",\n  "files": {}\n}\n'
    );
    record(ws, "core", "rewrite the manifest");

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /does not describe the files recorded beside it/);
    assert.match(run.stderr, /edited without a sync/);
  });

  it("fails when the recorded manifest is not valid JSON", () => {
    const ws = recorded();
    writeFileSync(path.join(ws.path("core"), ".devkit", MANIFEST_FILE), "{\n");
    record(ws, "core", "break the manifest");

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /is not valid JSON/);
  });

  it("fails when a recorded .devkit/ has no manifest in it", () => {
    const ws = recorded();
    rmSync(path.join(ws.path("core"), ".devkit", MANIFEST_FILE));
    record(ws, "core", "drop the manifest");

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /with no manifest\.json in it/);
  });
});

describe("a repository with no copy", () => {
  it("is reported as not enrolled, and passes", () => {
    const ws = make({ submodules: ["core", "plugins"] });

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /core\s+– not enrolled/);
    assert.match(run.stdout, /plugins\s+– not enrolled/);
    assert.match(run.stdout, /no submodule records a devkit copy/);
  });

  it("fails when the copy is in the checkout but not in the commit", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stdout, /core\s+✘ enrolled here, not recorded/);
    assert.match(run.stderr, /Commit it in core, push, and stage the gitlink/);
  });

  it("stays silent about a repository that never carried one", () => {
    const ws = recorded({ submodules: ["core", "plugins"] });

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /plugins\s+– not enrolled/);
  });
});

describe("what it reads, and what it does not", () => {
  it("reads the index rather than HEAD, so a staged gitlink is checked", () => {
    const ws = recorded();
    git(ws.root, ["commit", "-m", "record the copy"]);
    appendFileSync(
      path.join(ws.path("core"), ".devkit/lib/hash.mjs"),
      "\n// edited in the copy\n"
    );
    git(ws.path("core"), ["add", "-A"]);
    git(ws.path("core"), ["commit", "-m", "a later, wrong commit"]);
    assert.equal(check(ws.root).status, 0, "HEAD still records the good copy");

    git(ws.root, ["add", "core"]);

    assert.equal(check(ws.root).status, 1);
  });

  it("reads the index rather than HEAD, so a staged fix is credited", () => {
    // `make` has already committed a workspace that records no copy.
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    assert.equal(check(ws.root).status, 1, "the copy is not recorded yet");

    record(ws, "core");

    assert.equal(check(ws.root).status, 0);
  });

  it("does not read a submodule's working tree", () => {
    const ws = recorded();
    appendFileSync(
      path.join(ws.path("core"), ".devkit/lib/hash.mjs"),
      "\n// uncommitted damage\n"
    );

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr);
  });

  it("does not move its verdict when a submodule is checked out elsewhere", () => {
    // A submodule checkout is routinely ahead of or behind the pointer, by
    // design, which is the whole reason the pointer is what is read.
    const ws = recorded();
    const first = git(ws.path("core"), ["rev-parse", "HEAD~1"]);
    git(ws.path("core"), ["checkout", "--detach", first]);
    assert.equal(existsSync(path.join(ws.path("core"), ".devkit")), false);

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.match(run.stdout, /core\s+✓ matches/);
  });

  it("reports an unstaged source change and does not fail on it", () => {
    const ws = recorded();
    appendFileSync(
      path.join(ws.root, "packages/devkit/src/lib/hash.mjs"),
      "\n// not staged\n"
    );

    const run = check(ws.root);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /has changes the index does not record/);
  });
});

describe("when the recorded state cannot be read at all", () => {
  it("fails when the index records no gitlink for a declared path", () => {
    const ws = recorded();
    git(ws.root, ["rm", "--cached", "core"]);

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stdout, /core\s+✘ no gitlink in the index/);
    assert.match(run.stderr, /records no submodule commit there/);
  });

  it("fails when the submodule is not initialized", () => {
    const ws = recorded();
    renameSync(
      path.join(ws.path("core"), ".git"),
      path.join(ws.base, "core-git")
    );

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /is not initialized/);
    assert.match(run.stderr, /npm run bootstrap/);
  });

  it("fails when the recorded commit is not in the submodule", () => {
    // A pointer nobody can fetch also breaks `git clone --recurse-submodules`
    // for everyone else, which is the failure this message names.
    const ws = recorded();
    const absent = "a".repeat(40);
    git(ws.root, [
      "update-index",
      "--cacheinfo",
      `160000,${absent},core`
    ]);

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /does not have aaaaaaaaaaaa/);
    assert.match(run.stderr, /fetch origin a{40}/);
  });

  it("fails when the index records no devkit source", () => {
    const ws = recorded();
    git(ws.root, ["rm", "-r", "--cached", "packages/devkit/src"]);

    const run = check(ws.root);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /no files under packages\/devkit\/src/);
  });
});

describe("the superproject helpers this depends on", () => {
  /**
   * Pinned here because that module is authored in `dynamicagents/dev-skills`
   * and this copy of it is overwritten by `npx skills update`. Its shape is not
   * ours to keep, so the one thing to notice is an update that changes it:
   * `scripts/discovery-rules.test.mjs` pins what only this repository can check
   * about the discovery skills for the same reason.
   */
  it("still export what the sync tool imports", () => {
    assert.equal(typeof declared, "function");
    assert.equal(typeof recordedCommit, "function");
    assert.equal(typeof help, "function");
    assert.equal(typeof workspaceRoot, "function");
  });

  it("still answer the gitlink from the index rather than from HEAD", () => {
    const ws = make({ submodules: ["core"] });
    const committed = recordedCommit(ws.root, "core");
    write(ws.path("core"), { "later.txt": "a later commit\n" });
    git(ws.path("core"), ["add", "-A"]);
    git(ws.path("core"), ["commit", "-m", "later"]);
    git(ws.root, ["add", "core"]);

    const staged = recordedCommit(ws.root, "core");

    assert.notEqual(staged, committed);
    assert.equal(staged, git(ws.path("core"), ["rev-parse", "HEAD"]));
    assert.deepEqual([...declared(ws.root).keys()], ["core"]);
  });
});
