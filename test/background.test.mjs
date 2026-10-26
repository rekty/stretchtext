// Exercises the shipped service worker with a fake chrome API and fake network:
// the device-flow sign-in, the authenticated span request, the session cache and
// the auth/quota error mapping. No real Pollen is spent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Values cross a vm realm, so compare them as plain JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeChrome() {
  const session = new Map();
  const local = new Map();
  const area = (store) => ({
    get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => store.has(key)).map((key) => [key, store.get(key)]));
    },
    set(values) {
      for (const [key, value] of Object.entries(values)) store.set(key, value);
    },
    remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
  });
  const chrome = {
    storage: { session: area(session), local: area(local) },
    runtime: { onMessage: { addListener: (fn) => (chrome._onMessage = fn) } },
    commands: { onCommand: { addListener: () => {} } },
    tabs: { sendMessage: async () => ({ state: "stretched" }) },
    scripting: { insertCSS: async () => {}, executeScript: async () => {} },
    _store: { session, local },
  };
  return chrome;
}

function loadWorker({ responses }) {
  const chrome = fakeChrome();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const reply = responses(String(url));
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    };
  };
  const context = vm.createContext({
    chrome,
    fetch,
    console,
    setTimeout,
    clearTimeout,
    importScripts: (...files) => {
      for (const file of files) vm.runInContext(read(`../${file}`), context);
    },
  });
  vm.runInContext(read("../background.js"), context);
  const send = (message) => {
    let answer;
    chrome._onMessage(message, {}, (value) => (answer = value));
    // The listener replies asynchronously; let the microtask queue drain.
    return new Promise((resolve) => setTimeout(() => resolve(answer), 0));
  };
  return { chrome, calls, send };
}

const openai = (content) => ({
  status: 200,
  body: { choices: [{ message: { content } }] },
});

test("asks for a device code and connects on approval", async () => {
  let polled = 0;
  const worker = loadWorker({
    responses: (url) => {
      if (url.endsWith("/api/device/code"))
        return {
          status: 200,
          body: {
            device_code: "dev-1",
            user_code: "ABCD-1234",
            verification_uri_complete: "https://enter.pollinations.ai/device?user_code=ABCD-1234",
            expires_in: 1800,
          },
        };
      polled += 1;
      return polled === 1
        ? { status: 428, body: { error: "authorization_pending" } }
        : { status: 200, body: { access_token: "sk_user", token_type: "bearer", expires_in: 604800 } };
    },
  });

  const connected = await worker.send({ type: "auth:connect" });
  assert.equal(connected.userCode, "ABCD-1234");
  assert.match(connected.verify, /user_code=ABCD-1234$/);
  assert.equal(JSON.parse(worker.calls[0].options.body).client_id, undefined);

  assert.equal((await worker.send({ type: "auth:status" })).state, "pending");
  assert.equal((await worker.send({ type: "auth:status" })).state, "connected");
  assert.equal(worker.chrome._store.session.get("key"), "sk_user");
});

test("signs out, and refuses to generate without a key", async () => {
  const worker = loadWorker({ responses: () => openai("{}") });
  const result = await worker.send({ type: "stx:spans", texts: ["a paragraph"] });
  assert.equal(result.error, "auth");
  assert.equal(worker.calls.length, 0);
});

test("sends one authenticated request and parses the spans", async () => {
  const worker = loadWorker({
    responses: (url) => {
      if (url.endsWith("/v1/chat/completions"))
        return openai(
          JSON.stringify({
            blocks: [{ i: 1, spans: [{ s: "short" }, { s: "grow", more: " with detail." }] }],
          }),
        );
      return { status: 200, body: [] };
    },
  });
  worker.chrome._store.session.set("key", "sk_user");

  const result = await worker.send({ type: "stx:spans", texts: ["a long paragraph"] });
  assert.deepEqual(plain(result.spans), [[{ s: "short" }, { s: "grow", more: "with detail." }]]);

  const request = JSON.parse(worker.calls[0].options.body);
  assert.equal(worker.calls[0].url, "https://gen.pollinations.ai/v1/chat/completions");
  assert.equal(worker.calls[0].options.headers.Authorization, "Bearer sk_user");
  assert.equal(request.model, "openai/gpt-5.4-nano");
  assert.deepEqual(request.response_format, { type: "json_object" });
  assert.match(request.messages[1].content, /1\. a long paragraph/);

  // Same page twice: the second answer comes from the session cache.
  await worker.send({ type: "stx:spans", texts: ["a long paragraph"] });
  assert.equal(worker.calls.length, 1);
});

test("maps an empty balance to the quota error", async () => {
  const worker = loadWorker({
    responses: () => ({ status: 402, body: { error: { message: "not enough pollen" } } }),
  });
  worker.chrome._store.session.set("key", "sk_user");

  const result = await worker.send({ type: "stx:spans", texts: ["a paragraph"] });
  assert.equal(result.error, "quota");
  assert.match(result.message, /not enough pollen/);
});

test("lists live text models", async () => {
  const worker = loadWorker({
    responses: () => ({
      status: 200,
      body: [
        { name: "openai/gpt-5.4-nano", title: "GPT-5.4 Nano", category: "text", output_modalities: ["text"] },
        { name: "paid/one", title: "Paid", category: "text", output_modalities: ["text"], paid_only: true },
        { name: "image/one", title: "Image", category: "image", output_modalities: ["image"] },
      ],
    }),
  });

  const { models } = await worker.send({ type: "models:list" });
  assert.deepEqual(plain(models), [
    { name: "openai/gpt-5.4-nano", title: "GPT-5.4 Nano", paid: false },
    { name: "paid/one", title: "Paid", paid: true },
  ]);
});
