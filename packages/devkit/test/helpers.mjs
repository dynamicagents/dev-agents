/**
 * Fixtures for the devkit's own suite: repositories, and workspaces holding
 * submodules.
 *
 * Everything is built in a temporary directory and nothing is committed here.
 * A committed fixture holding a deliberately dead reference or a deliberately
 * undeclared import would sit inside a scanned directory of this repository, and
 * the checkers would report themselves.
 *
 * Not a `*.test.mjs`, so the root's `node --test` glob does not pick it up.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** This package, whose `src/` and `sync.mjs` a workspace fixture copies. */
export const DEVKIT = path.resolve(import.meta.dirname, "..");

/** The workspace this package lives in, for the skill modules `sync.mjs` imports. */
const WORKSPACE = path.resolve(DEVKIT, "..", "..");

/**
 * Repositories of `{ relative path: contents }`, cleaned up together.
 *
 * `clean` is handed to `afterEach` by the caller rather than registered here,
 * because a module that registers a hook changes the behaviour of every file
 * that imports it.
 */
export function repositories() {
  const built = [];
  const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), "devkit-repo-"));
    built.push(root);
    write(root, files);
    return root;
  };
  return { repo, clean: () => cleanup(built) };
}

/** `{ relative path: contents }` into `root`, creating directories as needed. */
export function write(root, files) {
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(root, ...name.split("/"));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

const cleanup = (built) => {
  while (built.length > 0) rmSync(built.pop(), { recursive: true, force: true });
};

/** `git`, in `cwd`, with this fixture's identity rather than the machine's. */
export const git = (cwd, args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=devkit fixture",
      "-c",
      "user.email=devkit@example.invalid",
      "-c",
      "commit.gpgsign=false",
      // A submodule whose url is a local path is refused by default (CVE-2022-39253),
      // and every fixture submodule here is one.
      "-c",
      "protocol.file.allow=always",
      ...args
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();

/**
 * Workspace fixtures: a copy of this package and the skill modules it imports,
 * in a directory that can hold real submodules.
 *
 * The package is copied rather than pointed at, because `sync.mjs` resolves its
 * source from its own location and the paths it hands git have to be inside the
 * repository it is run in. A copy is also what lets a spec drop a file from the
 * source and watch the copies lose it.
 */
export function workspaces() {
  const built = [];

  const make = ({ submodules = [] } = {}) => {
    const base = mkdtempSync(path.join(tmpdir(), "devkit-ws-"));
    built.push(base);
    const root = path.join(base, "workspace");
    mkdirSync(root, { recursive: true });

    write(root, {
      "package.json": `${JSON.stringify(
        { name: "fixture-workspace", private: true, type: "module" },
        null,
        2
      )}\n`,
      ".gitmodules": ""
    });
    cpSync(path.join(DEVKIT, "src"), path.join(root, "packages/devkit/src"), {
      recursive: true
    });
    cpSync(
      path.join(DEVKIT, "sync.mjs"),
      path.join(root, "packages/devkit/sync.mjs")
    );
    cpSync(
      path.join(WORKSPACE, ".agents/skills/superproject/scripts"),
      path.join(root, ".agents/skills/superproject/scripts"),
      { recursive: true }
    );

    git(root, ["init", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", "the workspace"]);

    for (const name of submodules) {
      const origin = path.join(base, `origin-${name}`);
      mkdirSync(origin, { recursive: true });
      write(origin, {
        "package.json": `${JSON.stringify({ name, private: true }, null, 2)}\n`
      });
      git(origin, ["init", "-b", "main"]);
      git(origin, ["add", "-A"]);
      git(origin, ["commit", "-m", `${name}: first`]);
      git(root, ["submodule", "add", "--name", name, origin, name]);
      git(root, ["commit", "-m", `add ${name}`]);
    }

    return { root, base, path: (name) => path.join(root, name) };
  };

  return { make, clean: () => cleanup(built) };
}

/** `node <args>` in `cwd`, as its exit code and output, never throwing. */
export function node(cwd, args) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      status: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error)
    };
  }
}

/** A loaded `devkit.config.mjs`, as the checkers receive it. */
export const config = (sections) => ({ configured: true, sections });
