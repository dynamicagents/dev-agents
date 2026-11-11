/**
 * What identifies a vendored copy.
 *
 * Every property here is one the two sides of a copy depend on: a workspace
 * hashing the source and a repository hashing its copy have to agree without
 * being able to see each other.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MANIFEST_FILE,
  describeDifferences,
  differences,
  fileDigest,
  filesUnder,
  hashDirectory,
  manifestText,
  treeDigest
} from "../src/lib/hash.mjs";
import { repositories } from "./helpers.mjs";

const { repo, clean } = repositories();
afterEach(clean);

describe("the tree digest", () => {
  it("does not depend on the order the files were listed in", () => {
    const one = { "a.mjs": "x", "lib/b.mjs": "y" };
    const other = { "lib/b.mjs": "y", "a.mjs": "x" };

    assert.equal(treeDigest(one), treeDigest(other));
  });

  it("changes when a file's content changes", () => {
    assert.notEqual(
      treeDigest({ "a.mjs": "x" }),
      treeDigest({ "a.mjs": "y" })
    );
  });

  it("changes when a file moves, so a rename is a change", () => {
    assert.notEqual(
      treeDigest({ "a.mjs": "x" }),
      treeDigest({ "lib/a.mjs": "x" })
    );
  });

  it("cannot be spelled two ways by a path that looks like a digest", () => {
    // The `\u0000` is why: it is the one byte a path cannot contain, so no pair
    // of (path, digest) collides with another pair's text.
    assert.notEqual(
      treeDigest({ "a.mjs": "x\u0000b.mjs" }),
      treeDigest({ "a.mjs": "x", "b.mjs": "" })
    );
  });
});

describe("line endings", () => {
  it("hashes a CRLF file as its LF self", () => {
    // Line endings are the one difference git is entitled to introduce, and a
    // byte comparison would report every file as changed on a platform nobody
    // has a defect on.
    assert.equal(
      fileDigest(Buffer.from("one\r\ntwo\r\n")),
      fileDigest(Buffer.from("one\ntwo\n"))
    );
  });

  it("hashes a lone CR as itself, since nothing writes one by accident", () => {
    assert.notEqual(
      fileDigest(Buffer.from("one\rtwo")),
      fileDigest(Buffer.from("one\ntwo"))
    );
  });

  it("gives a CRLF checkout of a copy the same tree digest", () => {
    const lf = repo({ "a.mjs": "one\ntwo\n", "lib/b.mjs": "three\n" });
    const crlf = repo({ "a.mjs": "one\r\ntwo\r\n", "lib/b.mjs": "three\r\n" });

    assert.equal(hashDirectory(lf).tree, hashDirectory(crlf).tree);
  });
});

describe("the directory walk", () => {
  it("skips what it is told to, which is how the manifest stays out", () => {
    const dir = repo({
      "a.mjs": "x",
      [MANIFEST_FILE]: '{"tree":"whatever","files":{}}'
    });

    const { files, tree } = hashDirectory(dir, { skip: [MANIFEST_FILE] });

    assert.deepEqual(Object.keys(files), ["a.mjs"]);
    assert.equal(tree, treeDigest({ "a.mjs": fileDigest(Buffer.from("x")) }));
  });

  it("names every file under it as a posix path, sorted", () => {
    const dir = repo({ "z.mjs": "", "lib/a.mjs": "", "lib/deep/b.mjs": "" });

    assert.deepEqual(filesUnder(dir), ["lib/a.mjs", "lib/deep/b.mjs", "z.mjs"]);
  });

  it("answers an empty list for a directory that is not there", () => {
    assert.deepEqual(filesUnder(path.join(repo({}), "absent")), []);
  });
});

describe("the manifest", () => {
  it("is 2-space JSON with sorted keys and a trailing newline", () => {
    const text = manifestText({
      tree: "abc",
      files: { "z.mjs": "2", "a.mjs": "1" }
    });

    assert.equal(
      text,
      '{\n  "tree": "abc",\n  "files": {\n    "a.mjs": "1",\n    "z.mjs": "2"\n  }\n}\n'
    );
  });

  it("round-trips through a file", () => {
    const dir = repo({ "a.mjs": "x" });
    const hashed = hashDirectory(dir);
    const written = repo({ [MANIFEST_FILE]: manifestText(hashed) });

    assert.deepEqual(
      JSON.parse(readFileSync(path.join(written, MANIFEST_FILE), "utf8")),
      { tree: hashed.tree, files: hashed.files }
    );
  });
});

describe("how two file sets differ", () => {
  it("names what differs, what is missing and what is extra", () => {
    const found = differences(
      { "a.mjs": "1", "b.mjs": "2" },
      { "a.mjs": "9", "c.mjs": "3" }
    );

    assert.deepEqual(found, {
      differing: ["a.mjs"],
      missing: ["b.mjs"],
      extra: ["c.mjs"]
    });
    assert.equal(
      describeDifferences(found),
      "differs: a.mjs; missing: b.mjs; not in the manifest: c.mjs"
    );
  });

  it("says nothing when the two agree", () => {
    assert.equal(describeDifferences(differences({ "a.mjs": "1" }, { "a.mjs": "1" })), null);
  });

  it("reads a file named like a prototype property as a file", () => {
    assert.deepEqual(
      differences({ constructor: "1" }, { constructor: "1" }),
      { differing: [], missing: [], extra: [] }
    );
  });
});
