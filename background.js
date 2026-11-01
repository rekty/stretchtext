// Service worker: holds the reader's Pollen key, runs the device-flow sign-in,
// and turns paragraphs into stretchtext spans with one text request per page.
// Classic worker (no "type": "module") so it can importScripts the shared prompt.
importScripts("shared/prompt.js");

const GEN = "https://gen.pollinations.ai";
const ENTER = "https://enter.pollinations.ai";
// A pk_ key from https://enter.pollinations.ai/keys → Apps attributes traffic to
// its owner on the consent screen. Empty still signs in, just unattributed.
const APP_KEY = "pk_OHEztfDm6JCbDSWT";
const DEFAULT_MODEL = "openai/gpt-5.4-nano";
const SCRIPTS = ["shared/engine.js", "shared/prompt.js", "content/stretch.js"];
const MAX_TOKENS = 2400;

const session = chrome.storage.session;

function httpError(res, body) {
  const error = new Error(`${res.status} ${body?.error?.message || body?.message || ""}`.trim());
  if (res.status === 401 || res.status === 403) error.code = "auth";
  if (res.status === 402 || res.status === 429) error.code = "quota";
  return error;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function connect() {
  const res = await fetch(`${ENTER}/api/device/code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(APP_KEY ? { client_id: APP_KEY } : {}),
  });
  const data = await readJson(res);
  if (!res.ok || !data.device_code) throw httpError(res, data);
  await session.set({
    device: data.device_code,
    deviceUntil: Date.now() + (data.expires_in || 1800) * 1000,
    userCode: data.user_code,
    verify: data.verification_uri_complete || data.verification_uri,
  });
  return {
    state: "pending",
    userCode: data.user_code,
    verify: data.verification_uri_complete || data.verification_uri,
  };
}

// One poll per status check: the popup asks every couple of seconds while a
// code is pending, so no timer has to survive service-worker suspension.
async function poll() {
  const { device, deviceUntil, userCode, verify } = await session.get([
    "device",
    "deviceUntil",
    "userCode",
    "verify",
  ]);
  if (!device) return { state: "idle" };
  if (Date.now() > deviceUntil) {
    await session.remove(["device", "deviceUntil", "userCode", "verify"]);
    return { state: "expired" };
  }
  const res = await fetch(`${ENTER}/api/device/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code: device }),
  });
  const data = await readJson(res);
  if (data.access_token) {
    await session.remove(["device", "deviceUntil", "userCode", "verify"]);
    await session.set({
      key: data.access_token,
      keyUntil: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
    });
    return { state: "connected" };
  }
  if (data.error === "authorization_pending" || res.status === 428) {
    return { state: "pending", userCode, verify };
  }
  await session.remove(["device", "deviceUntil", "userCode", "verify"]);
  return { state: "error", message: data.error_description || data.error || `HTTP ${res.status}` };
}

async function status() {
  const polled = await poll();
  if (polled.state !== "idle") return polled;
  const { key, keyUntil } = await session.get(["key", "keyUntil"]);
  if (!key) return { state: "signed-out" };
  if (keyUntil && Date.now() > keyUntil) {
    await session.remove(["key", "keyUntil"]);
    return { state: "signed-out", message: "the key expired, connect again" };
  }
  return { state: "connected" };
}

async function keyOrThrow() {
  const { key, keyUntil } = await session.get(["key", "keyUntil"]);
  if (!key || (keyUntil && Date.now() > keyUntil)) {
    const error = new Error("connect your Pollen");
    error.code = "auth";
    throw error;
  }
  return key;
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

async function spans(texts) {
  const key = await keyOrThrow();
  const { model } = await chrome.storage.local.get("model");
  const chosen = model || DEFAULT_MODEL;
  const digest = `cache:${hash(`${chosen}\n${texts.join("\n")}`)}`;
  const cached = (await session.get(digest))[digest];
  if (cached) return cached;

  const res = await fetch(`${GEN}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chosen,
      messages: STXPrompt.buildMessages(texts),
      temperature: 0.2,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    }),
  });
  const data = await readJson(res);
  if (!res.ok) throw httpError(res, data);
  const reply = data.choices?.[0]?.message?.content || "";
  const parsed = STXPrompt.parse(reply, texts.length);
  await session.set({ [digest]: parsed });
  return parsed;
}

async function models() {
  const res = await fetch(`${GEN}/text/models`);
  if (!res.ok) throw new Error(`model list: HTTP ${res.status}`);
  const list = await res.json();
  return list
    .filter((model) => model.category === "text" && model.output_modalities?.includes("text"))
    .map((model) => ({ name: model.name, title: model.title, paid: Boolean(model.paid_only) }));
}

async function toggleTab(tabId) {
  const message = { type: "stx:toggle" };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // Not injected in this tab yet: this is the first run after the user's gesture.
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content/stretch.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: SCRIPTS });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("no active tab");
  return tab.id;
}

async function handle(message) {
  switch (message?.type) {
    case "auth:connect":
      return connect();
    case "auth:status":
      return status();
    case "auth:key": {
      const key = String(message.key || "").trim();
      if (!/^sk_/.test(key)) throw new Error("that is not an sk_ key");
      await session.set({ key, keyUntil: 0 });
      return { state: "connected" };
    }
    case "auth:signout":
      await session.remove(["key", "keyUntil", "device", "deviceUntil"]);
      return { state: "signed-out" };
    case "models:list":
      return { models: await models() };
    case "stx:spans":
      return { spans: await spans(message.texts) };
    case "stretch:toggle":
      return toggleTab(message.tabId || (await activeTabId()));
    default:
      return { error: "unknown message" };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  handle(message).then(reply, (error) =>
    reply({ error: error.code || "failed", message: error.message }),
  );
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-stretch") activeTabId().then(toggleTab).catch(() => {});
});
