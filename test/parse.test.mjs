import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

vm.runInThisContext(readFileSync(new URL("../shared/prompt.js", import.meta.url), "utf8"));
const { parse, buildMessages } = globalThis.STXPrompt;

test("parses a fenced reply into one span array per paragraph", () => {
  const reply = [
    "```json",
    JSON.stringify({
      blocks: [
        { spans: [{ s: "Alpha stays." }, { s: "grow this", more: "with the detail." }] },
        { spans: [{ s: "Beta stays." }] },
      ],
    }),
    "```",
  ].join("\n");

  assert.deepEqual(parse(reply, 2), [
    [{ s: "Alpha stays." }, { s: "grow this", more: "with the detail." }],
    [{ s: "Beta stays." }],
  ]);
});

test("keeps block order even when the model skips one", () => {
  const reply = JSON.stringify({
    blocks: [
      { i: 1, spans: [{ s: "first" }] },
      { i: 3, spans: [{ s: "third" }] },
    ],
  });

  const spans = parse(reply, 3);
  assert.equal(spans.length, 3);
  assert.deepEqual(spans[0], [{ s: "first" }]);
  assert.deepEqual(spans[1], []);
  assert.deepEqual(spans[2], [{ s: "third" }]);
});

test("drops empty spans and empty detail", () => {
  const reply = JSON.stringify({
    blocks: [{ spans: [{ s: "keep" }, { s: "   " }, { s: "plain", more: "  " }] }],
  });

  assert.deepEqual(parse(reply, 1), [[{ s: "keep" }, { s: "plain" }]]);
});

test("throws on a reply without JSON", () => {
  assert.throws(() => parse("Sorry, I can't do that.", 1), /did not reply with JSON/);
});

test("numbers paragraphs in the request", () => {
  const messages = buildMessages(["one is here", "two is here"]);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.match(messages[1].content, /1\. one is here\n\n2\. two is here/);
});
