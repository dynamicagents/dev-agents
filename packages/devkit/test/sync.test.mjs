/**
 * `devkit:sync`: what it writes, where, and into which repositories.
 *
 * It is driven as the script, in a fixture workspace holding a copy of this
 * package, because the two inputs that decide everything are its own location
 * and the directory it is run from. A spec calling a function would have to
 * invent both.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { MANIFEST_FILE, filesUnder } from "../src/lib/hash.mjs";
import { node, workspaces, write } from "./helpers.mjs";

const { make, clean } = workspaces();
afterEach(clean);

const sync = (root, ...args) =>
  node(root, ["packages/devkit/sync.mjs", ...args]);

const copyOf = (ws, name) => path.join(ws.path(name), ".devkit");

describe("who gets a copy", () => {
  it("writes nothing when no submodule carries one", () => {
    const ws = make({ submodules: ["core"] });

    const run = sync(ws.root);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /No submodule carries a \.devkit\/ yet/);
    assert.equal(existsSync(copyOf(ws, "core")), false);
  });

  it("writes a first copy only when told to enroll one", () => {
    const ws = make({ submodules: ["core", "plugins"] });

    const run = sync(ws.root, "--enroll", "core");

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /core: wrote a first \.devkit\//);
    assert.equal(existsSync(path.join(copyOf(ws, "core"), MANIFEST_FILE)), true);
    assert.equal(existsSync(copyOf(ws, "plugins")), false);
  });

  it("tells the author what it cannot do itself", () => {
    const ws = make({ submodules: ["core"] });

    const run = sync(ws.root, "--enroll", "core");

    assert.match(run.stdout, /node \.devkit\/<name>\.mjs/);
    assert.match(run.stdout, /devkit:verify/);
    assert.match(run.stdout, /\.prettierignore/);
  });

  it("refuses to enroll a repository that already carries a copy", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");

    const run = sync(ws.root, "--enroll", "core");

    assert.equal(run.status, 1);
    assert.match(run.stderr, /already carries a \.devkit\/, so it is already enrolled/);
  });

  it("refuses a bare name, so a typo cannot enroll anything", () => {
    const ws = make({ submodules: ["core"] });

    const run = sync(ws.root, "core");

    assert.equal(run.status, 1);
    assert.match(run.stderr, /only read after `--enroll`/);
    assert.equal(existsSync(copyOf(ws, "core")), false);
  });

  it("refuses a name .gitmodules does not declare", () => {
    const ws = make({ submodules: ["core"] });

    const run = sync(ws.root, "--enroll", "nonesuch");

    assert.equal(run.status, 1);
    assert.match(run.stderr, /not a submodule of this workspace/);
    assert.match(run.stderr, /declares: core/);
  });

  it("refreshes every enrolled repository and no others", () => {
    const ws = make({ submodules: ["core", "plugins"] });
    sync(ws.root, "--enroll", "core");

    const run = sync(ws.root);

    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /core: unchanged\./);
    assert.doesNotMatch(run.stdout, /plugins/);
  });
});

describe("what a copy contains", () => {
  it("mirrors src/ and nothing else in the package", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");

    const copied = filesUnder(copyOf(ws, "core"));
    const source = filesUnder(path.join(ws.root, "packages/devkit/src"));

    assert.deepEqual(copied, [...source, MANIFEST_FILE].sort());
    assert.equal(copied.includes("sync.mjs"), false);
  });

  it("writes nothing outside .devkit/", () => {
    const ws = make({ submodules: ["core"] });
    const before = filesUnder(ws.path("core"));

    sync(ws.root, "--enroll", "core");

    const after = filesUnder(ws.path("core")).filter(
      (file) => !file.startsWith(".devkit/")
    );
    assert.deepEqual(after, before);
  });

  it("is byte-identical to the source", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");

    for (const file of filesUnder(path.join(ws.root, "packages/devkit/src"))) {
      assert.deepEqual(
        readFileSync(path.join(copyOf(ws, "core"), ...file.split("/"))),
        readFileSync(path.join(ws.root, "packages/devkit/src", ...file.split("/"))),
        file
      );
    }
  });
});

describe("running it again", () => {
  it("changes nothing and says so", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    const first = readFileSync(
      path.join(copyOf(ws, "core"), MANIFEST_FILE),
      "utf8"
    );

    const run = sync(ws.root);

    assert.match(run.stdout, /core: unchanged\./);
    assert.equal(
      readFileSync(path.join(copyOf(ws, "core"), MANIFEST_FILE), "utf8"),
      first
    );
  });

  it("puts back a file somebody edited in the copy", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    const edited = path.join(copyOf(ws, "core"), "verify-references.mjs");
    writeFileSync(edited, "// a fix typed into the copy\n");

    const run = sync(ws.root);

    assert.match(run.stdout, /core: 1 written/);
    assert.match(readFileSync(edited, "utf8"), /^#!\/usr\/bin\/env node/);
  });

  it("removes a file the source does not have", () => {
    // A rename in the source must not leave a stale module behind that
    // something still imports.
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    writeFileSync(path.join(copyOf(ws, "core"), "lib", "stray.mjs"), "export {};\n");

    const run = sync(ws.root);

    assert.match(run.stdout, /1 removed/);
    assert.equal(
      existsSync(path.join(copyOf(ws, "core"), "lib", "stray.mjs")),
      false
    );
  });

  it("drops a module the source dropped, and rewrites the manifest", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    write(ws.root, { "packages/devkit/src/extra.mjs": "export const e = 1;\n" });
    sync(ws.root);
    assert.equal(existsSync(path.join(copyOf(ws, "core"), "extra.mjs")), true);

    rmSync(path.join(ws.root, "packages/devkit/src/extra.mjs"));
    const run = sync(ws.root);

    assert.match(run.stdout, /1 removed, manifest\.json rewritten/);
    assert.equal(existsSync(path.join(copyOf(ws, "core"), "extra.mjs")), false);
  });
});

describe("the copy's own self-check", () => {
  it("passes on a fresh copy and fails on an edited one", () => {
    // This is what makes vendoring safe, and it runs in the recipient's CI,
    // which cannot see the workspace the source is in.
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    const core = ws.path("core");

    const clean = node(core, [".devkit/verify-devkit.mjs"]);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /matches its manifest/);

    // Appended rather than replaced, because that is the shape of the mistake
    // this catches: a fix typed into the copy, which still loads.
    appendFileSync(
      path.join(core, ".devkit/lib/hash.mjs"),
      "\n// a fix typed into the copy\n"
    );
    const edited = node(core, [".devkit/verify-devkit.mjs"]);

    assert.equal(edited.status, 1);
    assert.match(edited.stderr, /differs: lib\/hash\.mjs/);
    assert.match(edited.stderr, /A copy is never edited here/);
  });

  it("fails when the manifest is gone", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    rmSync(path.join(copyOf(ws, "core"), MANIFEST_FILE));

    const run = node(ws.path("core"), [".devkit/verify-devkit.mjs"]);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /manifest\.json is missing/);
  });

  it("fails on a stray file in the copy", () => {
    const ws = make({ submodules: ["core"] });
    sync(ws.root, "--enroll", "core");
    writeFileSync(path.join(copyOf(ws, "core"), "stray.mjs"), "export {};\n");

    const run = node(ws.path("core"), [".devkit/verify-devkit.mjs"]);

    assert.equal(run.status, 1);
    assert.match(run.stderr, /not in the manifest: stray\.mjs/);
  });
});
