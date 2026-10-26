// Content script: owns the toggle for one tab and forwards paragraphs to the
// service worker, which holds the user's Pollen key.
(function () {
  if (globalThis.__stxHooked) return;
  globalThis.__stxHooked = true;

  function fail(res) {
    if (res?.error === "auth") return new Error("connect your Pollen in the popup");
    if (res?.error === "quota") return new Error("out of Pollen on this key");
    return new Error(res?.message || "request failed");
  }

  async function toggle() {
    if (STXEngine.isStretched()) return STXEngine.restore();
    return STXEngine.stretch(async (texts) => {
      const res = await chrome.runtime.sendMessage({ type: "stx:spans", texts });
      if (res?.error) throw fail(res);
      return res.spans;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type !== "stx:toggle") return;
    toggle().then(reply, (error) => reply({ state: "error", message: error.message }));
    return true;
  });
})();
