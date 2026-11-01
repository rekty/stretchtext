// Stretchtext prompt + reply parser. Plain script on purpose: the MV3 service
// worker loads it with importScripts, and the landing page loads it with a tag.
(function () {
  const SYSTEM = [
    "You turn paragraphs from a web page into stretchtext: a short version a reader can skim, where any phrase can be grown in place to reveal the detail that was left out.",
    "",
    "Rules:",
    '- Return spans for each paragraph, in reading order.',
    '- A span with only "s" is always shown. Use it for the connective text.',
    '- A span with "s" and "more" is a growable phrase: "s" is a short phrase (2-8 words) that fits the sentence, and "more" is the detail you removed, one or two sentences written to continue right after that phrase.',
    '- The always-shown spans plus the growable phrases must read as a correct, grammatical short version, around 30-60% of the original words.',
    '- Make every growable phrase a complete clause or sentence with its own closing punctuation, so the short version reads as finished sentences and "more" is a sentence or two that carries the detail you removed.',
    "- Keep every name, number and claim that changes meaning. Drop examples, adjectives, restatement and hedging.",
    "- Never invent facts. Never use markdown or HTML.",
    '- Reply with JSON only: {"blocks":[{"i":1,"spans":[{"s":"..."},{"s":"...","more":"..."}]}]}, where "i" is the paragraph number you were given.',
  ].join("\n");

  function buildMessages(texts) {
    const paragraphs = texts.map((text, i) => `${i + 1}. ${text}`).join("\n\n");
    return [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Paragraphs:\n\n${paragraphs}` },
    ];
  }

  function normalize(span) {
    const s = String(span?.s ?? "").trim();
    if (!s) return null;
    const more = String(span?.more ?? "").trim();
    return more ? { s, more } : { s };
  }

  // The substring from `start` to the bracket that closes it, ignoring
  // brackets inside strings. A model that keeps talking after the JSON, or
  // that repeats a key, cannot truncate what we read.
  function balanced(text, start) {
    const open = text[start];
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return text.slice(start);
  }

  // Every "blocks" array in the reply, in order. Some models answer a long
  // request as one object with the key repeated (JSON.parse would keep only
  // the last one, silently dropping paragraphs), so read each occurrence.
  function blocksFrom(text) {
    const found = [];
    const key = /"blocks"\s*:\s*\[/g;
    let match;
    while ((match = key.exec(text))) {
      const start = match.index + match[0].length - 1;
      const arrayText = balanced(text, start);
      try {
        const list = JSON.parse(arrayText);
        if (Array.isArray(list)) found.push(...list);
      } catch {
        // Skip an unreadable array and keep the rest.
      }
      key.lastIndex = start + arrayText.length;
    }
    if (found.length) return found;

    // No blocks key at all: accept a bare array, or an object holding one.
    const start = text.search(/[[{]/);
    if (start < 0) return found;
    try {
      const value = JSON.parse(balanced(text, start));
      if (Array.isArray(value)) return value;
      const only = Object.values(value).find((item) => Array.isArray(item));
      return only || found;
    } catch {
      return found;
    }
  }

  // Returns one span array per input text, so the caller can index by block.
  function parse(raw, count) {
    const text = String(raw || "")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    if (!/[[{]/.test(text)) throw new Error("model did not reply with JSON");
    const blocks = blocksFrom(text);
    const out = Array.from({ length: count }, () => []);
    // Place by the echoed paragraph number, so one skipped block cannot shift
    // another paragraph's spans onto the wrong text. Fall back to order.
    blocks.forEach((block, position) => {
      const echoed = Number.isInteger(block?.i) ? block.i - 1 : -1;
      const index = echoed >= 0 && echoed < count ? echoed : position;
      if (index < 0 || index >= count) return;
      const spans = Array.isArray(block?.spans) ? block.spans : [];
      out[index] = spans.map(normalize).filter(Boolean);
    });
    return out;
  }

  globalThis.STXPrompt = { SYSTEM, buildMessages, parse };
})();
