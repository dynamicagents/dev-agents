/**
 * `link:local`, with the command runner replaced.
 *
 * The runner is a parameter for one reason, and it is the reason this file
 * exists: the lockfile has to be put back when the install **throws**, and no
 * real `npm install` can be asked to fail on demand. The fake one here rewrites
 * the lockfile the way npm does and then fails, which is the state that left a
 * CI runner with a lockfile full of temporary paths.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { linkLocal } from "../src/lib/link-local.mjs";
import { config, repositories } from "./helpers.mjs";

const { repo, clean } = repositories();
afterEach(clean);

const LOCKFILE = '{\n  "name": "fixture",\n  "lockfileVersion": 3\n}\n';

/** A repository with sibling checkouts beside it, as `link:local` expects. */
function fixture({ siblings = ["core"], lockfile = LOCKFILE } = {}) {
  const files = { "repo/package.json": '{ "name": "fixture" }\n' };
  if (lockfile !== null) files["repo/package-lock.json"] = lockfile;
  for (const name of siblings)
    files[`${name}/package.json`] = `{ "name": "${name}" }\n`;
  const base = repo(files);
  return { base, root: path.join(base, "repo") };
}

/**
 * A runner that behaves like npm: `pack` leaves a tarball behind, `install`
 * rewrites the lockfile, and `fail` makes the install throw after it has.
 */
function runner({ rewrites = true, fail = false } = {}) {
  const calls = [];
  let packed = 0;
  const run = (_command, args, options) => {
    calls.push(args[0]);
    if (args[0] === "pack") {
      packed += 1;
      writeFileSync(path.join(args[2], `packed-${packed}.tgz`), "tarball");
      return;
    }
    if (rewrites)
      writeFileSync(
        path.join(options.cwd, "package-lock.json"),
        '{ "resolved": "file:/tmp/da-pack-abc/packed-1.tgz" }\n'
      );
    if (fail) throw new Error("npm install failed");
  };
  return { calls, run };
}

const sections = (linkLocalSection) => config({ linkLocal: linkLocalSection });
const silent = () => {};

describe("which checkouts it packs", () => {
  it("packs every required sibling and installs the tarballs", () => {
    const { root } = fixture({ siblings: ["core", "plugins"] });
    const npm = runner({ rewrites: false });

    const { packed, tarballs } = linkLocal(
      root,
      sections({ siblings: ["core", "plugins"] }),
      { run: npm.run, log: silent }
    );

    assert.deepEqual(packed, ["core", "plugins"]);
    assert.equal(tarballs.length, 2);
    assert.deepEqual(npm.calls, ["pack", "pack", "install"]);
  });

  it("errors on a required sibling that is not checked out", () => {
    const { root } = fixture({ siblings: [] });

    assert.throws(
      () =>
        linkLocal(root, sections({ siblings: ["core"] }), {
          run: runner().run,
          log: silent
        }),
      /core not found at/
    );
  });

  it("skips an optional sibling that is not checked out", () => {
    const { root } = fixture({ siblings: ["core"] });
    const said = [];

    const { packed } = linkLocal(
      root,
      sections({ siblings: ["core"], optional: ["g2a-protocol"] }),
      { run: runner({ rewrites: false }).run, log: (line) => said.push(line) }
    );

    assert.deepEqual(packed, ["core"]);
    assert.ok(
      said.some((line) => /g2a-protocol not checked out/.test(line)),
      said.join("\n")
    );
  });

  it("packs an optional sibling that is checked out", () => {
    const { root } = fixture({ siblings: ["core", "g2a-protocol"] });

    const { packed } = linkLocal(
      root,
      sections({ siblings: ["core"], optional: ["g2a-protocol"] }),
      { run: runner({ rewrites: false }).run, log: silent }
    );

    assert.deepEqual(packed, ["core", "g2a-protocol"]);
  });

  it("says which key is missing when the repository configured none", () => {
    const { root } = fixture();

    assert.throws(
      () => linkLocal(root, config({}), { run: runner().run, log: silent }),
      /has no `linkLocal` section/
    );
  });
});

describe("the lockfile, afterwards", () => {
  it("is restored when the install rewrote it", () => {
    const { root } = fixture();

    linkLocal(root, sections({ siblings: ["core"] }), {
      run: runner().run,
      log: silent
    });

    assert.equal(
      readFileSync(path.join(root, "package-lock.json"), "utf8"),
      LOCKFILE
    );
  });

  it("is restored when the install rewrote it and then threw", () => {
    const { root } = fixture();

    assert.throws(
      () =>
        linkLocal(root, sections({ siblings: ["core"] }), {
          run: runner({ fail: true }).run,
          log: silent
        }),
      /npm install failed/
    );

    assert.equal(
      readFileSync(path.join(root, "package-lock.json"), "utf8"),
      LOCKFILE
    );
  });

  it("is removed when there was none before", () => {
    const { root } = fixture({ lockfile: null });

    linkLocal(root, sections({ siblings: ["core"] }), {
      run: runner().run,
      log: silent
    });

    assert.equal(existsSync(path.join(root, "package-lock.json")), false);
  });

  it("is removed when there was none before and the install threw", () => {
    const { root } = fixture({ lockfile: null });

    assert.throws(() =>
      linkLocal(root, sections({ siblings: ["core"] }), {
        run: runner({ fail: true }).run,
        log: silent
      })
    );

    assert.equal(existsSync(path.join(root, "package-lock.json")), false);
  });

  it("is left alone when the install did not touch it", () => {
    const { root } = fixture();

    linkLocal(root, sections({ siblings: ["core"] }), {
      run: runner({ rewrites: false }).run,
      log: silent
    });

    assert.equal(
      readFileSync(path.join(root, "package-lock.json"), "utf8"),
      LOCKFILE
    );
  });
});
