/**
 * The lexer both source checkers read through.
 *
 * Every case here is a character that can appear inside something it does not
 * belong to: a quote in a regex, a `/*` in a character class, a backtick in a
 * class, a `from` in a prompt string. Each one that names a measurement is a
 * defect one of the two checkers had while it did its own scanning.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lex } from "../src/lib/lexer.mjs";

/** The code mask, which is what a caller reads to ask what precedes a token. */
const code = (text) => lex(text).code;

/** `text` with `[from, to)` as spaces, which is what the mask should be. */
const blanked = (text, from, to) =>
  text.slice(0, from) + " ".repeat(to - from) + text.slice(to);

const newlines = (text) =>
  [...text].flatMap((character, at) => (character === "\n" ? [at] : []));
const comments = (text) => lex(text).comments.map((span) => span.text);
const strings = (text) => lex(text).strings.map((span) => span.value);

describe("the code mask", () => {
  it("is the same length as the input, so an offset still names its place", () => {
    const text = 'const a = 1; // and "b"\n/* c */ const d = `e`;\n';

    assert.equal(code(text).length, text.length);
  });

  it("keeps newlines, so a line counted from an offset is the right line", () => {
    const text = "/* one\ntwo */\nconst a = 1;\n";

    assert.deepEqual(newlines(code(text)), newlines(text));
  });

  it("blanks a comment, both forms", () => {
    const trailing = "const a = 1; // x\n";
    assert.equal(
      code(trailing),
      blanked(trailing, trailing.indexOf("//"), trailing.indexOf("\n"))
    );

    const block = "const /* x */ a;";
    assert.equal(
      code(block),
      blanked(block, block.indexOf("/*"), block.indexOf("*/") + 2)
    );
  });

  it("blanks a string's contents and keeps its delimiters", () => {
    // The delimiters are what stop a caller reading straight through a string
    // when it asks what code precedes the next one.
    assert.equal(code('const a = "one two";'), 'const a = "       ";');
  });

  it("keeps an interpolation, because what is in one is code", () => {
    assert.equal(code("const a = `x ${y} z`;"), "const a = `  ${y}  `;");
  });

  it("blanks a regex literal, so its delimiters reach nothing", () => {
    const text = "const r = /[/*]/;";

    assert.equal(
      code(text),
      blanked(text, text.indexOf("/["), text.lastIndexOf("/") + 1)
    );
  });
});

describe("what it reads as a comment", () => {
  it("reads a trailing comment, which is where half of them live", () => {
    assert.deepEqual(comments("export const a = 1; // see b\n"), ["// see b"]);
  });

  it("does not read a `//` inside a regex as opening one", () => {
    assert.deepEqual(comments("const slashes = /[//]/;\n"), []);
  });

  it("does not read a `/*` inside a character class as opening one", () => {
    // The measurement: `/[/*]/` and `/\/*$/` are both in this train, and a
    // scan that read either as a comment lost everything after it.
    assert.deepEqual(comments('const chars = /[/*]/;\nconst a = "b";\n'), []);
    assert.deepEqual(comments('const t = url.replace(/\\/*$/, "/");\n'), []);
  });

  it("keeps `image/*` a value rather than the start of one", () => {
    assert.deepEqual(comments('const kind = "image/*";\n// real\n'), ["// real"]);
  });

  it("reads a division as a division, so what follows it still counts", () => {
    assert.deepEqual(comments("const half = total / 2; // real\n"), ["// real"]);
  });

  it("reads a regex where a keyword puts one, not a division", () => {
    assert.deepEqual(
      comments('if (typeof s !== `string`) return /[`"]/.test(s);\n// real\n'),
      ["// real"]
    );
  });
});

describe("what it records as a string", () => {
  it("records both quote styles, and a template", () => {
    assert.deepEqual(strings('const a = "x", b = \'y\', c = `z`;'), [
      "x",
      "y",
      "z"
    ]);
  });

  it("records nothing for a quote that never closed on its line", () => {
    // A `'` or `"` cannot carry a raw newline, so one still open at the end of
    // a line was a character inside something this read as code.
    assert.deepEqual(strings("const r = /it's/;\nconst a = 1;\n"), []);
  });

  it("does not record a string inside a comment", () => {
    assert.deepEqual(strings('// const a = "x";\nconst b = 1;\n'), []);
  });

  it("does not record a quote inside a regex as opening one", () => {
    assert.deepEqual(
      strings('const specifiers = /(?:from|import)\\s*"([^"]+)"/g;\n'),
      []
    );
  });

  it("marks a template carrying an interpolation", () => {
    const [plain, interpolated] = lex("const a = `x`, b = `y ${z}`;").strings;

    assert.equal(plain.interpolated, false);
    assert.equal(interpolated.interpolated, true);
  });

  it("does not let a nested template end the outer one early", () => {
    assert.deepEqual(strings("const label = `outer ${`inner`} done`;"), [
      "inner",
      "outer ${`inner`} done"
    ]);
  });

  it("names where each string starts, which is its opening quote", () => {
    const text = 'import "ghost";';

    assert.deepEqual(
      lex(text).strings.map((string) => string.start),
      [text.indexOf('"')]
    );
  });
});
