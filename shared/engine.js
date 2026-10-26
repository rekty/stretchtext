// The stretchtext engine: finds the readable paragraphs on a page, swaps each
// one for its short version, and grows the detail back in place on a click.
// No chrome.* here, so the landing page runs the same code on a sample page.
(function () {
  if (globalThis.STXEngine) return;

  const BLOCKS = "p, li, blockquote, dd, figcaption";
  const SKIP =
    'nav, header, footer, aside, form, pre, code, [role="navigation"], [aria-hidden="true"]';
  const MIN_CHARS = 120;
  const MAX_BLOCKS = 14;
  const MAX_CHARS = 7000;
  const OPEN = /^[.,;:!?)\]}]/;

  const originals = new Map();
  let busy = false;

  function readable(el) {
    if (el.closest(SKIP)) return false;
    if (el.querySelector(BLOCKS) || el.querySelector("button, input, textarea, select"))
      return false;
    const box = el.getBoundingClientRect();
    return box.height > 0 && box.width > 200;
  }

  function collect() {
    const blocks = [];
    let chars = 0;
    for (const el of document.querySelectorAll(BLOCKS)) {
      if (blocks.length >= MAX_BLOCKS) break;
      if (!readable(el)) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (text.length < MIN_CHARS) continue;
      if (chars + text.length > MAX_CHARS) break;
      chars += text.length;
      blocks.push({ el, text });
    }
    return blocks;
  }

  function words(text) {
    return (text.match(/\S+/g) || []).length;
  }

  // Spans carry bare text, so spacing is ours to get right: no double spaces,
  // no space before a comma.
  function append(fragment, node, text) {
    const last = fragment.lastChild;
    const tail = last ? last.textContent : "";
    if (tail && text && !/\s$/.test(tail) && !OPEN.test(text)) {
      fragment.append(document.createTextNode(" "));
    }
    fragment.append(node);
  }

  function grow(phrase, more) {
    const open = phrase.getAttribute("aria-expanded") === "true";
    if (open) {
      const extra = phrase.nextElementSibling;
      if (extra && extra.classList.contains("stx-more")) extra.remove();
      phrase.setAttribute("aria-expanded", "false");
      return;
    }
    const detail = document.createElement("span");
    detail.className = "stx-more";
    const body = String(more).trim();
    detail.append(document.createTextNode(OPEN.test(body) ? body : ` ${body}`));
    phrase.after(detail);
    requestAnimationFrame(() => detail.classList.add("stx-in"));
    phrase.setAttribute("aria-expanded", "true");
  }

  function render(el, spans) {
    const fragment = document.createDocumentFragment();
    for (const span of spans) {
      if (!span.more) {
        append(fragment, document.createTextNode(span.s), span.s);
        continue;
      }
      // A span, not a button: Chrome keeps button text on one line, which would
      // push every phrase onto its own line instead of letting it wrap.
      const phrase = document.createElement("span");
      phrase.className = "stx-grow";
      phrase.setAttribute("role", "button");
      phrase.setAttribute("tabindex", "0");
      phrase.setAttribute("aria-expanded", "false");
      phrase.title = "Grow this";
      phrase.textContent = span.s;
      phrase.addEventListener("click", () => grow(phrase, span.more));
      phrase.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        grow(phrase, span.more);
      });
      append(fragment, phrase, span.s);
    }
    el.replaceChildren(fragment);
    return el.textContent;
  }

  function pill(text, ms) {
    let el = document.getElementById("stx-pill");
    if (!el) {
      el = document.createElement("div");
      el.id = "stx-pill";
      el.className = "stx-pill";
      el.setAttribute("role", "status");
      document.documentElement.append(el);
    }
    el.textContent = text;
    el.classList.add("stx-show");
    clearTimeout(pill.timer);
    if (ms) pill.timer = setTimeout(() => el.classList.remove("stx-show"), ms);
  }

  // provider: (texts: string[]) => Promise<span[][]>
  async function stretch(provider) {
    if (busy) return { state: "busy" };
    if (originals.size) return { state: "stretched" };
    const blocks = collect();
    if (!blocks.length) return { state: "empty" };

    busy = true;
    const before = blocks.reduce((sum, block) => sum + words(block.text), 0);
    pill(`StretchText: condensing ${blocks.length} paragraphs…`);
    try {
      const spans = await provider(blocks.map((block) => block.text));
      let after = 0;
      blocks.forEach((block, i) => {
        if (!spans[i] || !spans[i].length) return;
        originals.set(block.el, [...block.el.childNodes]);
        block.el.classList.add("stx-block");
        after += words(render(block.el, spans[i]));
      });
      if (!originals.size) {
        pill("StretchText: nothing to stretch here", 6000);
        return { state: "empty" };
      }
      const saved = Math.max(0, Math.round((1 - after / before) * 100));
      pill(
        `StretchText: ${originals.size} paragraphs, ${saved}% fewer words. Click a dotted phrase to grow it.`,
        8000,
      );
      return { state: "stretched", blocks: originals.size, saved };
    } finally {
      busy = false;
    }
  }

  function restore() {
    for (const [el, nodes] of originals) {
      el.replaceChildren(...nodes);
      el.classList.remove("stx-block");
    }
    originals.clear();
    pill("StretchText: original page restored", 3000);
    return { state: "restored" };
  }

  globalThis.STXEngine = {
    stretch,
    restore,
    collect,
    isStretched: () => originals.size > 0,
  };
})();
