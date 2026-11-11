# `@dynamicagents/devkit`

The repo-level checkers the train's repositories share. Private, never published,
and vendored into each repository that runs one as `.devkit/`.

Why a copy rather than a published bin: a repository's own tooling should not
need a release of another package to be fixed, and a dependency from a submodule
onto `@dynamicagents/core` for a checker is a cycle waiting to be noticed. The
cost of a copy is drift, and that cost is paid by a manifest plus two checks: the
recipient's own `devkit:verify`, and this workspace's `devkit:check`.

## The scripts

Each is run as `node .devkit/<name>.mjs` from a repository root, which is where
`npm run` puts it. The findings live in `.devkit/lib/`; the entry prints them and
sets the exit code.

| script                     | what it fails on                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `verify-references.mjs`    | a comment naming a path that is not there                                            |
| `verify-peer-ranges.mjs`   | a peer range the installed tree does not satisfy; `--latest` reports against the registry |
| `verify-runtime-types.mjs` | committed runtime types carrying a global `Env`                                       |
| `verify-exports.mjs`       | built output that is not safe to publish                                             |
| `link-local.mjs`           | not a check: packs the sibling checkouts and installs them                           |
| `verify-devkit.mjs`        | this copy not matching the manifest beside it                                        |

**One prerequisite, and only for one script.** `verify-peer-ranges.mjs` imports
`semver`, so a repository that wires it declares `semver` in its own
`devDependencies`. Everything else here is Node builtins, so a repository that
wires the rest needs nothing it does not already have.

## What a repository wires

In its `package.json`:

```jsonc
"scripts": {
  "verify:references": "node .devkit/verify-references.mjs",
  "devkit:verify": "node .devkit/verify-devkit.mjs",
  "check": "… && npm run devkit:verify"
}
```

And in its `.prettierignore`:

```
# A vendored copy, identified by a content hash. `prettier --write .` would
# rewrite it and break that hash.
.devkit/
```

`devkit:verify` in `check` is not optional. It is what makes a copy safe to keep:
a fix typed into one fails in the repository it was typed in, naming the file,
and it works in that repository's CI, which cannot see this workspace.

## `devkit.config.mjs`

Per-repository rules go in one module at the repository root, a section per
checker. Every key is optional and the file itself is too; a checker with no
section does what it does everywhere, and one that cannot work without a section
says which key is missing.

```js
export default {
  // `verify-references.mjs`
  references: {
    scan: ["src", "test", "scripts"], // directories read, and the roots a rooted reference may start at
    loose: ["README.md", "AGENTS.md"], // root files read whole for prose
    external: new Map([["./elsewhere.ts", "why this one is not ours"]])
  },

  // `verify-exports.mjs`
  exports: {
    realmExempt: ["./testing"], // subpaths that are a test harness
    nodeOnly: ["./sandbox/daemon"], // subpaths whose realm is Node, not a Worker
    buildsOn: { "./computer": ["./sandbox"] }, // turns subpath isolation on, with its exceptions
    forbidRootExport: true, // no "." barrel
    zeroDependencies: true // no bare import in dist/, no dependency keys
  },

  // `link-local.mjs`
  linkLocal: {
    siblings: ["core"], // required checkouts
    optional: ["g2a-protocol"] // packed when present
  }
};
```

It is a module rather than JSON because every entry carries prose: why a root
file is scanned, why a path is allowed, why one subpath may reach another. An
allowlist without reasons becomes a silencer, and JSON has nowhere to write one.

## Refreshing a copy

From the workspace root:

```bash
npm run devkit:sync                     # refresh every enrolled submodule
npm run devkit:sync -- --enroll <repo>  # write a first copy into one
npm run devkit:check                    # the recorded copies match the recorded source
```

**A copy is never edited in place.** The fix goes in `packages/devkit/src` and a
sync carries it out, which is also the order `AGENTS.md` writes down under "The
devkit": the submodule copy PRs merge first, and the dev-agents PR lands the
source change and the new gitlinks together.

**Everything under `src/` is vendored and nothing else here is.** `sync.mjs`,
`test/` and this file stay in the workspace: the sync tool is not something a
recipient runs, and the suite belongs to the source.
