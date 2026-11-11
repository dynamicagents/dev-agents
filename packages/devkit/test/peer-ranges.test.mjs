/**
 * The peer-range check, over fixture repositories with a fixture
 * `node_modules`.
 *
 * The installed tree is the input, so every case here writes one: that is the
 * whole point of the checker, and a fixture that declared peers without
 * installing them would only ever exercise the absent-peer path.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLatest,
  verifyPeerRanges
} from "../src/lib/peer-ranges.mjs";
import { repositories } from "./helpers.mjs";

const { repo, clean } = repositories();
afterEach(clean);

/** A repository declaring `peers` with `installed` in its `node_modules`. */
const fixture = ({ peers = {}, meta, installed = {} }) => {
  const files = {
    "package.json": `${JSON.stringify(
      {
        name: "fixture",
        peerDependencies: peers,
        ...(meta ? { peerDependenciesMeta: meta } : {})
      },
      null,
      2
    )}\n`
  };
  for (const [name, version] of Object.entries(installed)) {
    files[`node_modules/${name}/package.json`] =
      `${JSON.stringify({ name, version })}\n`;
  }
  return repo(files);
};

const failuresOf = (options) => verifyPeerRanges(fixture(options)).failures;

describe("the installed copy against the declared range", () => {
  it("passes when the installed version satisfies the range", () => {
    const { failures, checked } = verifyPeerRanges(
      fixture({ peers: { agents: "^1.2.0" }, installed: { agents: "1.3.0" } })
    );

    assert.deepEqual(failures, []);
    assert.deepEqual(checked, [["agents", "^1.2.0", "1.3.0"]]);
  });

  it("fails when the installed version is outside it", () => {
    const [failure, ...rest] = failuresOf({
      peers: { agents: "^0.21.0" },
      installed: { agents: "0.22.0" }
    });

    assert.deepEqual(rest, []);
    assert.match(failure, /declares "\^0\.21\.0", but 0\.22\.0 is installed/);
  });

  it("fails on a required peer nobody installed", () => {
    const [failure] = failuresOf({ peers: { agents: ">=1" } });

    assert.match(failure, /required at ">=1" but is not installed/);
  });

  it("passes over an optional peer nobody installed", () => {
    const { failures, peers, checked } = verifyPeerRanges(
      fixture({
        peers: { vitest: ">=4" },
        meta: { vitest: { optional: true } }
      })
    );

    assert.deepEqual(failures, []);
    // What the entry's "(optional peers absent: skipped)" note reads.
    assert.equal(peers.length > checked.length, true);
  });

  it("fails on a range semver cannot parse", () => {
    const [failure] = failuresOf({ peers: { agents: "newest-ish" } });

    assert.match(failure, /which is not a valid semver range/);
  });

  it("throws on an installed manifest that exists and cannot be read", () => {
    // Absent is the only error that means absent. A half-written tree must not
    // let an *optional* peer through this gate while unreadable, which is the
    // one case nothing downstream would notice either, so this fixture declares
    // the peer optional and still expects to hear about it.
    const broken = repo({
      "package.json": `${JSON.stringify({
        name: "fixture",
        peerDependencies: { agents: ">=1" },
        peerDependenciesMeta: { agents: { optional: true } }
      })}\n`,
      "node_modules/agents/package.json": "{ not json\n"
    });

    assert.throws(() => verifyPeerRanges(broken), /is not valid JSON/);
  });
});

describe("peerDependenciesMeta", () => {
  it("fails on a key that names no peer", () => {
    const [failure] = failuresOf({
      peers: { agents: ">=1" },
      meta: { vitest: { optional: true } },
      installed: { agents: "1.0.0" }
    });

    assert.match(failure, /has "vitest", which is not a peer/);
  });

  it("fails on a key that is only a prototype property", () => {
    // `in` would walk the prototype chain and decide `constructor` is a peer.
    const [failure] = failuresOf({
      peers: { agents: ">=1" },
      meta: { constructor: { optional: true } },
      installed: { agents: "1.0.0" }
    });

    assert.match(failure, /has "constructor", which is not a peer/);
  });
});

describe("what the registry says, classified", () => {
  const checked = [["agents", ">=0.33.0 <0.34.0", "0.33.1"]];

  it("reports a newest release the range excludes", () => {
    const { outsideRange, untested, rows } = classifyLatest(
      checked,
      new Map([["agents", "0.34.0"]])
    );

    assert.deepEqual(outsideRange, [
      ["agents", ">=0.33.0 <0.34.0", "0.34.0"]
    ]);
    assert.deepEqual(untested, []);
    assert.equal(rows[0].at(-1), "outside the range");
  });

  it("reports a newest release the range admits and nothing has run", () => {
    const { outsideRange, untested } = classifyLatest(
      checked,
      new Map([["agents", "0.33.9"]])
    );

    assert.deepEqual(outsideRange, []);
    assert.deepEqual(untested, [
      ["agents", ">=0.33.0 <0.34.0", "0.33.1", "0.33.9"]
    ]);
  });

  it("says nothing is owed when the installed copy is the newest", () => {
    const { rows, outsideRange, untested } = classifyLatest(
      checked,
      new Map([["agents", "0.33.1"]])
    );

    assert.equal(rows[0].at(-1), "up to date");
    assert.deepEqual([...outsideRange, ...untested], []);
  });

  it("says so when the registry did not answer", () => {
    const { rows, outsideRange, untested } = classifyLatest(
      checked,
      new Map([["agents", undefined]])
    );

    assert.match(rows[0].at(-1), /registry did not answer/);
    assert.deepEqual([...outsideRange, ...untested], []);
  });
});
