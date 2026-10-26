[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

# StretchText

**Install page:** https://rekty.github.io/stretchtext/ — the download, a demo you can click before
installing, and the setup steps.

A browser extension that turns any web page into [stretchtext](https://en.wikipedia.org/wiki/StretchText):
the short version loads first, and a click grows one phrase right where it stands. Click it again
and it shrinks back. Readers sign in and spend **their own Pollen**, never the developer's.

Ted Nelson described stretchtext in 1967 — text that grows where the reader wants more and shrinks
where they don't. Writing every level by hand is why it never caught on. Generating them is cheap
now, so every article can be lent the same affordance: you read six paragraphs instead of forty,
and open only the ones you need.

## What you get

- **Alt+S** on any article, and the page is rewritten in place: paragraphs become short, correct
  versions with dotted phrases where detail was removed.
- **Grow and shrink in place.** A dotted phrase inserts its detail right after itself; clicking it
  again removes that detail. Nothing moves to a side panel or another tab.
- **The page is never damaged.** The original nodes are kept in memory, so `Alt+S` (or Restore)
  puts the page back node for node, links and listeners included.
- **One request per page.** Up to 14 paragraphs (7,000 characters) go to one chat completion;
  results are cached for the browser session, so toggling twice costs nothing.
- **Your Pollen, your budget.** Sign-in is the Pollinations device flow: the extension receives an
  `sk_` key scoped to what you approved on the consent screen, keeps it in session storage, and
  never sees your account.

## Install

1. Download [dist/stretchtext-0.1.0.zip](dist/stretchtext-0.1.0.zip) from the
   [install page](https://rekty.github.io/stretchtext/) and unzip it, or clone this repository.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the
   unzipped folder.
3. Click the StretchText icon → **Connect Pollen** → enter the code at
   [enter.pollinations.ai/device](https://enter.pollinations.ai/device).
4. Open an article and press **Alt+S**.

Chromium browsers (Chrome, Edge, Brave, Arc) accept the unpacked folder as is. Firefox needs the
same files with `background.scripts` instead of a service worker; that build is not shipped yet.

## How it works

```
page ──► content/stretch.js ──► background.js ──► gen.pollinations.ai/v1/chat/completions
             │                        │                          │
             │                        └── sk_ key from enter.pollinations.ai (device flow)
             ▼
       shared/engine.js: short spans in, detail on click, originals kept for restore
```

- `shared/engine.js` — dependency-free engine: picks readable blocks, renders spans, grows and
  shrinks detail, restores the original nodes, shows the status pill. The landing page runs this
  same file, which is why the demo behaves exactly like the extension.
- `shared/prompt.js` — the stretchtext instructions and a parser that tolerates fences and short
  replies; one span array per paragraph, by index.
- `background.js` — device-flow sign-in, key and cache in `chrome.storage.session`, the model call,
  and per-tab injection (no content script runs until you activate the extension).
- `content/stretch.js` — the toggle for one tab; it owns no secrets.

Only two host permissions are requested, both Pollinations (`gen.` for generation, `enter.` for
sign-in). Page access comes from `activeTab`, granted when you click the icon or press Alt+S.

## Cost

One page is one chat completion. With the default `openai/gpt-5.4-nano` that is a few thousandths of
a Pollen; models marked free cost nothing. The popup lists the live text models, and the price of
the model you pick is the price you pay — no markup, no developer key in the middle.

## Privacy

Paragraph text goes to Pollinations to be condensed, and nothing else: no page URL, no cookies, no
account data leaves the browser. Spans are cached in `chrome.storage.session`, which is cleared when
the browser closes. Disconnect in the popup drops the key immediately.

## Maintenance

The extension is deliberately small and stays that way:

- **Model list is live.** The popup reads [gen.pollinations.ai/text/models](https://gen.pollinations.ai/text/models)
  every time it opens, so a new model appears without a release and a retired one disappears.
- **Prompt and parser live together** in `shared/prompt.js`; changing how pages are condensed is a
  one-file edit with a test next to it (`node --test`).
- **No build step, no dependencies.** The directory you clone is the extension you load, so fixes
  ship in one commit and no toolchain can rot.
- **API drift is caught by the tests and the demo page**: both call the shipped files, not a copy.
- **Issues and PRs are read.** Breaking changes on the Pollinations side (endpoint, device flow,
  `response_format`) get a release within days rather than a fork.

## Develop

```bash
node --test          # prompt parser contract
node --check background.js content/stretch.js shared/engine.js shared/prompt.js popup/popup.js
python -m http.server 8000   # then open http://localhost:8000 for the hand-written demo
```

The demo uses fixed spans, so it never spends Pollen; the engine and CSS it runs are the shipped
ones.

## Credits

Stretchtext as a reading idea is Ted Nelson's. The "grow a phrase in place" interaction owes a debt
to [cc-stretch](https://github.com/pro-vi/cc-stretch) (MIT), which does this for Claude's replies.
Text generation by [Pollinations](https://pollinations.ai).

MIT licensed.
