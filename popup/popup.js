const $ = (id) => document.getElementById(id);
const DEFAULT_MODEL = "openai/gpt-5.4-nano";
let polling = false;

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { error: "failed", message: error.message };
  }
}

function show({ signin, device, ready }) {
  $("signin").hidden = !signin;
  $("device").hidden = !device;
  $("ready").hidden = !ready;
}

function render(state) {
  if (state.state === "connected") {
    show({ signin: false, device: false, ready: true });
    loadModels();
    return;
  }
  if (state.state === "pending") {
    show({ signin: true, device: true, ready: false });
    $("usercode").textContent = state.userCode || "";
    $("open-device").onclick = () => chrome.tabs.create({ url: state.verify });
    if (!polling) waitForApproval();
    return;
  }
  show({ signin: true, device: false, ready: false });
  if (state.message) $("result").textContent = state.message;
}

async function waitForApproval() {
  polling = true;
  while (polling) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const state = await send({ type: "auth:status" });
    if (state.state !== "pending") {
      polling = false;
      if (state.state === "error") $("result").textContent = state.message;
      render(state);
      return;
    }
  }
}

async function loadModels() {
  const select = $("model");
  if (select.options.length > 1) return;
  const { models } = await send({ type: "models:list" });
  if (!models?.length) return;
  select.replaceChildren(
    ...models.map((model) => {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = model.paid ? `${model.title} (paid)` : model.title;
      return option;
    }),
  );
  const { model: saved } = await chrome.storage.local.get("model");
  select.value = models.some((model) => model.name === saved) ? saved : DEFAULT_MODEL;
  select.onchange = () => chrome.storage.local.set({ model: select.value });
}

$("connect").onclick = async () => {
  $("connect").disabled = true;
  const state = await send({ type: "auth:connect" });
  $("connect").disabled = false;
  if (state.error) $("result").textContent = state.message || "sign-in failed";
  render(state);
};

$("stretch").onclick = async () => {
  const button = $("stretch");
  button.disabled = true;
  const state = await send({ type: "stretch:toggle" });
  button.disabled = false;
  if (state?.error) {
    $("result").textContent =
      state.error === "auth"
        ? "Your Pollen key expired. Disconnect and connect again."
        : state.message || "the page could not be stretched";
    if (state.error === "auth") render({ state: "signed-out" });
    return;
  }
  if (state.state === "restored") {
    $("result").textContent = "Original page restored.";
    return;
  }
  if (state.state === "empty") {
    $("result").textContent = "No readable paragraphs on this page.";
    return;
  }
  $("result").textContent = `${state.blocks} paragraphs, ${state.saved}% fewer words.`;
  setTimeout(() => window.close(), 1200);
};

$("signout").onclick = async () => {
  await send({ type: "auth:signout" });
  render({ state: "signed-out" });
};

$("paste").onclick = async () => {
  const state = await send({ type: "auth:key", key: $("key").value });
  if (state.error) $("result").textContent = state.message || "that key was rejected";
  render(state);
};

send({ type: "auth:status" }).then(render);
