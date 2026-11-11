/**
 * The runtime-types check: the committed `worker-configuration.d.ts` carries no
 * global `Env`.
 *
 * Column zero is the whole test, so every fixture here is about indentation:
 * the global this rejects is unindented, and the `Cloudflare.Env` seam it must
 * leave alone is nested inside a namespace.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RUNTIME_TYPES, verifyRuntimeTypes } from "../src/lib/runtime-types.mjs";
import { repositories } from "./helpers.mjs";

const { repo, clean } = repositories();
afterEach(clean);

const verify = (contents) =>
  verifyRuntimeTypes(
    repo({ "package.json": "{}\n", [RUNTIME_TYPES]: contents })
  );

describe("the generated runtime types", () => {
  it("fails on a global `interface Env`", () => {
    const { globals } = verify(
      "interface Env {\n  AI: Ai;\n}\ndeclare const x: 1;\n"
    );

    assert.deepEqual(globals, ["interface Env {"]);
  });

  it("fails on a global `declare interface Env`", () => {
    const { globals } = verify("declare interface Env {}\n");

    assert.deepEqual(globals, ["declare interface Env {}"]);
  });

  it("passes the namespaced `Cloudflare.Env`, which is the extension point", () => {
    const { globals, missing } = verify(
      [
        "declare namespace Cloudflare {",
        "  interface Env {}",
        "}",
        "declare module 'cloudflare:test' {}",
        ""
      ].join("\n")
    );

    assert.deepEqual(globals, []);
    assert.equal(missing, false);
  });

  it("does not read `EnvLike` as the global", () => {
    const { globals } = verify("interface EnvLike {}\n");

    assert.deepEqual(globals, []);
  });

  it("reports the file as missing rather than passing", () => {
    // It is committed, not generated on demand, so its absence is a tree that
    // cannot typecheck rather than a repository with nothing to check.
    const { missing, globals } = verifyRuntimeTypes(
      repo({ "package.json": "{}\n" })
    );

    assert.equal(missing, true);
    assert.deepEqual(globals, []);
  });
});
