/**
 * The publish gate, over fixture packages with a fixture `dist/`.
 *
 * One case per check and per config key. The checks run on built output, so
 * every fixture writes the `dist/` it is about: a fixture with only sources
 * would exercise none of this.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { verifyExports } from "../src/lib/exports.mjs";
import { config, repositories } from "./helpers.mjs";

const { repo, clean } = repositories();
afterEach(clean);

/** A package with `manifest` merged into its own, and `files` in its tree. */
const fixture = (manifest, files) =>
  repo({
    "package.json": `${JSON.stringify({ name: "fixture", ...manifest }, null, 2)}\n`,
    ...files
  });

const failuresOf = (manifest, files, sections = {}) =>
  verifyExports(fixture(manifest, files), config(sections)).failures;

const only = (failures) => {
  assert.equal(failures.length, 1, failures.join("\n"));
  return failures[0];
};

describe("checks every repository gets", () => {
  it("fails on an exports target that did not emit", () => {
    const failure = only(
      failuresOf({ exports: { "./a": "./dist/a.js" } }, {
        "dist/b.js": "export const b = 1;\n"
      })
    );

    assert.match(failure, /points at \.\/dist\/a\.js, which does not exist/);
  });

  it("fails on an extensionless relative import in a .js", () => {
    const failure = only(
      failuresOf({ exports: { "./a": "./dist/a.js" } }, {
        "dist/a.js": 'export * from "./b";\n',
        "dist/b.js": "export const b = 1;\n"
      })
    );

    assert.match(failure, /imports "\.\/b" without a \.js extension/);
  });

  it("fails on an extensionless relative import in a .d.ts", () => {
    // A type-only relative import is erased from the emitted `.js` and lives
    // only here, so scanning one file class leaves the other unchecked.
    const failure = only(
      failuresOf(
        { exports: { "./a": { types: "./dist/a.d.ts", import: "./dist/a.js" } } },
        {
          "dist/a.js": "export const a = 1;\n",
          "dist/a.d.ts": 'export type { B } from "./b";\n',
          "dist/b.d.ts": "export type B = 1;\n"
        }
      )
    );

    assert.match(failure, /a\.d\.ts imports "\.\/b" without a \.js extension/);
  });

  it("fails on a spec that reached dist", () => {
    const failure = only(
      failuresOf({}, { "dist/a.spec.js": "it('runs', () => {});\n" })
    );

    assert.match(failure, /spec file shipped to dist/);
  });

  it("fails on a source map that reached dist", () => {
    const failure = only(
      failuresOf({}, { "dist/a.js.map": '{"sources":["../src/a.ts"]}\n' })
    );

    assert.match(failure, /source map shipped to dist/);
  });

  it("fails on a runtime subpath that can reach a test-only module", () => {
    const failure = only(
      failuresOf({ exports: { "./a": "./dist/a.js" } }, {
        "dist/a.js": 'export * from "./b.js";\n',
        "dist/b.js": 'import { readFileSync } from "node:fs";\nexport const b = readFileSync;\n'
      })
    );

    assert.match(failure, /runtime subpath "\.\/a" can reach test-only modules: node:fs/);
  });

  it("fails on a bare specifier the manifest does not declare", () => {
    const failure = only(
      failuresOf({ exports: { "./a": "./dist/a.js" } }, {
        "dist/a.js": 'import { x } from "ghost";\nexport const a = x;\n'
      })
    );

    assert.match(
      failure,
      /imports "ghost", but ghost is in neither dependencies nor peerDependencies/
    );
  });

  it("fails on one reachable only from the declaration graph", () => {
    // The runtime graph has already erased a type-only import, so a package
    // reachable only there breaks a consumer's typecheck and nothing else.
    const failure = only(
      failuresOf(
        { exports: { "./a": { types: "./dist/a.d.ts", import: "./dist/a.js" } } },
        {
          "dist/a.js": "export const a = 1;\n",
          "dist/a.d.ts": 'import type { G } from "ghost";\nexport declare const a: G;\n'
        }
      )
    );

    assert.match(failure, /declares a type from "ghost"/);
  });

  it("walks the declaration graph in declaration space", () => {
    // `tsc` writes a `.js` specifier in a `.d.ts` too, and that `.js` exists
    // beside it. Resolving naively steps into the runtime graph on the first
    // hop, which is the graph that cannot see a type-only import at all.
    const failure = only(
      failuresOf(
        { exports: { "./a": { types: "./dist/a.d.ts", import: "./dist/a.js" } } },
        {
          "dist/a.js": 'export * from "./b.js";\n',
          "dist/a.d.ts": 'export type { B } from "./b.js";\n',
          "dist/b.js": "export const b = 1;\n",
          "dist/b.d.ts": 'import type { G } from "ghost";\nexport type B = G;\n'
        }
      )
    );

    assert.match(failure, /declares a type from "ghost"/);
  });

  it("reads code and not a comment that discusses an import", () => {
    // These checks are documented with the specifiers they were written for, so
    // a scan without comment stripping re-reports its own prose.
    const failures = failuresOf({ exports: { "./a": "./dist/a.js" } }, {
      "dist/a.js": [
        '// import { x } from "ghost";',
        '/** `import "node:fs"` is what this used to do. */',
        'const kind = "image/*";',
        "export const a = kind;",
        ""
      ].join("\n")
    });

    assert.deepEqual(failures, []);
  });

  it("allows the package's own name as a specifier", () => {
    const failures = failuresOf({ exports: { "./a": "./dist/a.js" } }, {
      "dist/a.js": 'export * from "fixture/other";\n'
    });

    assert.deepEqual(failures, []);
  });
});

describe("the checks a repository asks for", () => {
  const testHarness = {
    "dist/testing/index.js": 'import { it } from "vitest";\nexport const t = it;\n'
  };
  const harnessManifest = {
    peerDependencies: { vitest: ">=4" },
    exports: { "./testing": "./dist/testing/index.js" }
  };

  it("exempts a declared test harness from the realm check", () => {
    assert.match(
      only(failuresOf(harnessManifest, testHarness)),
      /can reach test-only modules: vitest/
    );
    assert.deepEqual(
      failuresOf(harnessManifest, testHarness, {
        exports: { realmExempt: ["./testing"] }
      }),
      []
    );
  });

  it("exempts a subpath under a declared one", () => {
    assert.deepEqual(
      failuresOf(
        {
          peerDependencies: { vitest: ">=4" },
          exports: { "./testing/node": "./dist/testing/node.js" }
        },
        { "dist/testing/node.js": 'import "vitest";\n' },
        { exports: { realmExempt: ["./testing"] } }
      ),
      []
    );
  });

  it("gives a nodeOnly subpath the Node realm and nothing else", () => {
    const manifest = {
      peerDependencies: { vitest: ">=4" },
      exports: { "./daemon": "./dist/daemon.js" }
    };
    const sections = { exports: { nodeOnly: ["./daemon"] } };

    assert.deepEqual(
      failuresOf(manifest, { "dist/daemon.js": 'import "node:fs";\n' }, sections),
      []
    );
    assert.match(
      only(
        failuresOf(manifest, { "dist/daemon.js": 'import "vitest";\n' }, sections)
      ),
      /can reach test-only modules: vitest/
    );
  });

  it("fails a reach into a sibling's directory only where isolation is on", () => {
    const manifest = {
      exports: {
        "./one": "./dist/one/index.js",
        "./two": "./dist/two/index.js"
      }
    };
    const files = {
      "dist/one/index.js": 'export * from "../two/index.js";\n',
      "dist/two/index.js": "export const two = 1;\n"
    };

    assert.deepEqual(failuresOf(manifest, files), []);
    assert.match(
      only(failuresOf(manifest, files, { exports: { buildsOn: {} } })),
      /subpath "\.\/one" reaches outside its own directory/
    );
    assert.deepEqual(
      failuresOf(manifest, files, {
        exports: { buildsOn: { "./one": ["./two"] } }
      }),
      []
    );
  });

  it("leaves a type-only reach into a sibling alone", () => {
    // Isolation is about what a consumer's bundle grows by, and a type-only
    // import is erased before anything loads it.
    assert.deepEqual(
      failuresOf(
        {
          exports: {
            "./one": { types: "./dist/one/index.d.ts", import: "./dist/one/index.js" },
            "./two": "./dist/two/index.js"
          }
        },
        {
          "dist/one/index.js": "export const one = 1;\n",
          "dist/one/index.d.ts": 'export type { Two } from "../two/index.js";\n',
          "dist/two/index.js": "export const two = 1;\n",
          "dist/two/index.d.ts": "export type Two = 1;\n"
        },
        { exports: { buildsOn: {} } }
      ),
      []
    );
  });

  it("fails a root barrel where one is forbidden", () => {
    const manifest = { exports: { ".": "./dist/index.js" } };
    const files = { "dist/index.js": "export const all = 1;\n" };

    assert.deepEqual(failuresOf(manifest, files), []);
    assert.match(
      only(failuresOf(manifest, files, { exports: { forbidRootExport: true } })),
      /"\." is exported/
    );
  });

  it("fails any bare import under zeroDependencies", () => {
    const failure = only(
      failuresOf(
        { exports: { "./a": "./dist/a.js" }, peerDependencies: {} },
        { "dist/a.js": 'import { x } from "jose";\nexport const a = x;\n' },
        { exports: { zeroDependencies: true } }
      )
    );

    assert.match(failure, /must have no dependencies/);
  });

  it("fails a declared dependency under zeroDependencies", () => {
    const failures = failuresOf(
      { dependencies: { jose: "^6" }, optionalDependencies: { x: "^1" } },
      {},
      { exports: { zeroDependencies: true } }
    );

    assert.equal(failures.length, 2, failures.join("\n"));
    assert.match(failures[0], /declares dependencies: jose/);
    assert.match(failures[1], /declares optionalDependencies: x/);
  });

  it("reads a bare import in a .d.ts under zeroDependencies", () => {
    const failure = only(
      failuresOf(
        {},
        { "dist/a.d.ts": 'import type { J } from "jose";\nexport type A = J;\n' },
        { exports: { zeroDependencies: true } }
      )
    );

    assert.match(failure, /a\.d\.ts imports "jose"/);
  });
});

describe("what it reports when there is nothing to report", () => {
  it("counts the subpaths, the runtime entries and the emitted modules", () => {
    const { failures, counts, zeroDependencies } = verifyExports(
      fixture(
        {
          exports: {
            "./a": { types: "./dist/a.d.ts", import: "./dist/a.js" },
            "./package.json": "./package.json"
          }
        },
        { "dist/a.js": "export const a = 1;\n", "dist/a.d.ts": "export declare const a: 1;\n" }
      ),
      config({})
    );

    assert.deepEqual(failures, []);
    assert.deepEqual(counts, { subpaths: 2, runtimeEntries: 1, modules: 1 });
    assert.equal(zeroDependencies, false);
  });
});
