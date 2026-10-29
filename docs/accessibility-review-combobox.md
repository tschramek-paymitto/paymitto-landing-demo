# Accessibility Review — Destination Combobox

## Scope & method

**Component.** The Destination selector in the PayMitto Global Transfers rate widget — a custom `role="combobox"` trigger that opens a panel containing a search textbox and a `role="listbox"` of payout corridors — plus the delivery-method tile group that sits immediately below it and is driven by the same quote state.

**Files reviewed** (all paths relative to `/Users/tschramek/Developer/claude-code/paymitto-global-transfer-demo`):

| File | Role |
|---|---|
| `app.js` | combobox logic (`comboRender`, `comboSetActive`, `comboOpen/Close/Choose`), `renderMethods`, corridor fetch |
| `styles.css` | all component styling (1,242 lines; the only other stylesheet, `keystone/keystone-theme.css`, overrides radius tokens only) |
| `index.html` | root host page markup |
| `keystone/index.html` | second host page, structurally identical (line numbers offset by +1) |
| `netlify/functions/corridors.mjs`, `quote.mjs` | data sources (long country names originate here) |
| `docs/architecture-azure-embed-widget.md` | the stated iframe-embed deployment target |

**Dimensions.** Four passes: ARIA semantics, keyboard & focus, visual contrast & motion, mobile/touch/embed.

**Target.** WCAG 2.2 Level AA. Items that are real defects but fail no AA success criterion (forced-colors behaviour, iOS auto-zoom, APG pattern deviations, touch ergonomics) are reported as such and labelled `n/a — <reason>` rather than dressed up as conformance failures.

**Adversarial verification.** Every finding from the four passes was re-checked against the source by a second pass that was instructed to try to break it: re-reading the cited lines, re-computing every contrast ratio from sRGB luminance rather than trusting the reported number, tracing code paths by hand, and looking for compensating mechanisms elsewhere in the codebase. **3 findings were rejected outright** and are excluded. Several survivors were downgraded for inflated impact or misapplied success criteria; where a proposed fix would have introduced a new defect, the fix below is the corrected one, and the original is noted.

**24 verified findings** are reported here as **21 ticket IDs** — three pairs were the same defect surfaced independently by two different dimension passes and have been merged (noted inline).

---

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 12 |
| Info | 2 |
| **Total** | **21** |

Rejected during verification: **3**.

**The top issues:**

- **The keyboard position in the option list is effectively invisible.** The active row is distinguished from its neighbours by a single background wash measured at **1.13:1** against the panel — against a 3:1 floor — and because the pattern is `aria-activedescendant`, DOM focus never enters the list, so that wash *is* the focus indicator (A11Y-02).
- **The delivery-method tiles expose no selected state at all.** Selection is a CSS class and nothing more: no `aria-pressed`, no `aria-checked`, no role. A screen-reader user cannot tell which method the displayed fee and rate belong to (A11Y-01).
- **Nothing in the widget is a live region.** Zero `aria-live` / `role="status"` across all four files. Filtering is silent, the "No destinations match" state is silent, and the recalculated quote is silent (A11Y-05).
- **Search filtering drops the active option entirely.** When the query excludes the currently selected destination — the common case — `aria-activedescendant` is removed and Enter resolves to `undefined`, so the key is swallowed with no feedback (A11Y-04).

**Shippable?** **Yes, with the two High items fixed first.** Nothing in this component is a blocker: there is no keyboard trap, no focus trap, Escape and Tab both escape cleanly, every option is reachable and correctly named, `aria-selected` is maintained, and the quote flow completes by keyboard and by screen reader. But the component carries **two unambiguous Level A/AA failures on its primary controls** (A11Y-01, A11Y-02), both of which are `S`-effort and both of which are money-adjacent — they govern which corridor and which delivery method the displayed fee and rate belong to. Ship after A11Y-01 and A11Y-02; schedule the five Medium items into the following sprint, with A11Y-05 (live region) first because three other findings partially depend on it. The Low tier is a consistency-and-robustness backlog, dominated by two systemic root causes worth fixing as single token/media-query decisions rather than one ticket at a time: the absence of any forced-colors handling (A11Y-06, and A11Y-12/A11Y-14 fall out of it) and the `--pm-gray-100` control-boundary token (A11Y-13).

---

## Findings

### Critical

None.

---

### High

#### A11Y-01 — Delivery-method tiles expose no selected state; the chosen method is conveyed by a CSS class only

- **WCAG:** 4.1.2 Name, Role, Value (A); 1.3.1 Info and Relationships (A)
- **Component:** `app.js:444-457` (`renderMethods`); static markup `index.html:143-145`, `keystone/index.html:144-146`
- **Effort:** S

**Evidence.**

```js
btn.textContent = METHOD_LABELS[m] || m;
if (m === method) btn.classList.add("active");   // app.js:449
```

A repo-wide grep for `aria-pressed|aria-checked|radiogroup|aria-current` returns **zero hits** across `app.js`, `styles.css`, `index.html` and `keystone/index.html`. The click handler at `app.js:452-453` swaps the `.active` class and nothing else. The only selection cue is `styles.css:604-608` (border-color + background + color), which is invisible to assistive tech. The three tiles sit inside `role="group" aria-label="Delivery method"` (`index.html:142`) as plain `<button>` elements, and `app.js:451` assigns a single `method` scalar, so this is a mutually-exclusive single-select group rendered with no selected semantics. The static pre-JS markup has the same gap.

**Impact.** A screen-reader user hears "Bank account, button / Debit card deposit, button / Cash pickup, button" with nothing distinguishing the active one, and after activating a tile hears no state change at all. The delivery method drives both the fee and the quoted rate, so the user cannot tell which method the numbers on screen belong to. Level A, user-affecting, no mitigating path anywhere in the code.

**Fix.** Keep `role="group" aria-label="Delivery method"` on the wrapper and add `aria-pressed` to each tile:

- `app.js`, after line 449: `btn.setAttribute("aria-pressed", m === method ? "true" : "false");`
- in the click handler, extend the sweep at line 452 to also set `b.setAttribute("aria-pressed", "false")`, and after line 453 set `btn.setAttribute("aria-pressed", "true")`
- mirror on the static tiles: `aria-pressed="false"` on `index.html:143-144` / `keystone/index.html:144-145`, `aria-pressed="true"` on `index.html:145` / `keystone/index.html:146`

> **Verification note — the originally proposed fix was rejected.** The finding's primary recommendation was `role="radiogroup"` + `role="radio"` + `aria-checked`. Applying that without the rest of the APG radio pattern — roving tabindex (exactly one tabbable member) and Arrow/Home/End navigation that moves focus and selection — ships a broken pattern. None of that exists here: all three tiles stay in the tab order and `app.js:450` wires `click` only, with no `keydown` handler on `els.methodsWrap`. That would trade a missing-state failure for a wrong-role-plus-wrong-keyboard failure. `aria-pressed` is a complete 4.1.2 fix, needs no keyboard changes, and matches the interaction already implemented. If the team wants true radio semantics, use native `<input type="radio" name="method">` + `<label>` — `renderMethods` already rebuilds the markup wholesale at `app.js:443`, so the refactor is contained and native inputs give grouping, exclusivity, roving focus and arrow keys for free.

**Related:** A11Y-12 (the same tiles' visual state under forced colors), A11Y-05 (the recalculated fee/rate/ETA that follows a tile press is also unannounced).

---

#### A11Y-02 — Active option highlight is 1.13:1; the keyboard position in the listbox is effectively invisible

- **WCAG:** 1.4.11 Non-text Contrast (AA)
- **Component:** `styles.css:560-561`
- **Effort:** S
- *Raised independently by the keyboard-focus and visual-contrast passes; merged.*

**Evidence.**

```css
.combo__opt.is-active,
.combo__opt:hover { background: var(--pm-meridian-lightest); }
```

This is the complete active-row styling. `app.js:353-363` (`comboSetActive`) toggles only the `is-active` class plus `aria-activedescendant` — no inline style, no outline, no other mark. Measured computed styles on the live page after three ArrowDowns: active `{ backgroundColor: rgb(236,238,254), outlineStyle: none, borderLeftWidth: 0px }` vs neighbour `{ backgroundColor: rgba(0,0,0,0), outlineStyle: none, borderLeftWidth: 0px }` — font-weight and color are identical in both.

Ratios recomputed independently from sRGB luminance:

| Pair | L values | Ratio | Required |
|---|---|---|---|
| `#ECEEFE` on `#FEFDFC` | 0.8614 / 0.9835 | **1.134:1** | 3:1 |
| `#4451F6` on `#FEFDFC` | 0.1377 / 0.9835 | 5.507:1 | — |
| `#4451F6` on `#ECEEFE` | 0.1377 / 0.8614 | 4.856:1 | — |
| `#D8DCFD` on `#FEFDFC` (deeper-tint option) | — | 1.327:1 | 3:1 |

Grepping every CSS file for `is-active` returns exactly one `.combo__opt` match (line 560); `keystone-theme.css` redefines only radius tokens, so the ratio is identical on both host pages. No forced-colors or `prefers-contrast` block exists anywhere.

**Impact.** The options are not focusable — DOM focus stays on `#country-search` (`app.js:380`) — so this wash is the only "where am I" signal a sighted keyboard user has. At 1.13:1 it is below the threshold of perception on most displays and vanishes under glare, on a dimmed laptop, or on the uncalibrated monitors common on bank branch desks. A user arrows through 13+ corridors, sees nothing move, and commits to whichever row happened to be active. The highlight also doubles as `:hover`, so the two states are indistinguishable.

**Fix.** Pure CSS; touches no ARIA, so it cannot disturb the APG pattern. Replace `styles.css:560-561`, **keeping this selector order** (both selectors have specificity 0,2,0, so the later rule wins and a hovered-and-active row correctly shows the active treatment):

```css
.combo__opt:hover { background: var(--pm-snow); }
.combo__opt.is-active {
  background: var(--pm-meridian-lightest);
  outline: 2px solid var(--pm-meridian);
  outline-offset: -2px;
}
@media (forced-colors: active) {
  .combo__opt.is-active { outline-color: Highlight; }
}
```

`outline-offset: -2px` draws inside the `li` box so it is not clipped by `.combo__list { overflow-y: auto }` (`styles.css:537`). Leave `styles.css:558-559` (the check SVG and darker selected name) untouched so "what is chosen" stays separable from "where I am".

> **Verification notes.** (a) Both raisers proposed `box-shadow: inset 3px 0 0` and claimed it survives forced-colors. It does not — forced-colors drops `box-shadow` entirely. The **outline** is the property that survives and gets forced to a system color; that is why the fix above uses it. Keep the inset bar only as a light-mode brand affordance, never as the high-contrast mechanism. (b) One raiser cited 2.4.7 Focus Visible (A) and asserted a 3:1 requirement under it. 2.4.7 is arguably *satisfied* — DOM focus is on the search input, which has a real visible indicator (`styles.css:532-535`). The 3:1 threshold for a state indicator comes from **1.4.11 (AA)**; the focus-indicator contrast criterion is 2.4.13, which is **AAA in WCAG 2.2** and out of scope. Cite 1.4.11 only. (c) One raiser claimed the failure is worst at the default state; the opposite is true — `comboSetActive` is seeded to the selected index on open (`app.js:350`) and the selected row carries a `#4451F6` check SVG at 4.86:1 plus a darker name, making it the *most* marked row. The real failure window is after the user arrows away from the selection, which is still the common case. (d) Downgraded from Critical: this component produces a **quote, not a transfer**, so "sends money to the wrong country" is not supported by the code — `comboChoose` (`app.js:389-394`) only sets `els.country.value` and dispatches `change`. A mis-selection is immediately visible in the trigger label and trivially reversible, and `comboSetActive` calls `scrollIntoView` (`app.js:359`), giving a weak motion cue. Screen-reader users are unaffected. (e) Splitting `:hover` from `.is-active` buys less than it appears, because `app.js:428-431` sets `is-active` on `mousemove` anyway — still worth doing for the pre-mousemove frame and for touch/stylus. `--pm-snow` on `--pm-white` is only 1.06:1; that is acceptable for a convenience affordance but must not be treated as a second state indicator.

**Related:** A11Y-06 (the component-wide forced-colors gap this fix partially pre-empts), A11Y-14.

---

### Medium

#### A11Y-03 — Group headers use `role="presentation"` inside `role="listbox"`, so "Popular destinations" / "All destinations" are never announced

- **WCAG:** 1.3.1 Info and Relationships (A); APG Listbox pattern
- **Component:** `app.js:337` and `app.js:343`
- **Effort:** M

**Evidence.**

```js
html += '<li class="combo__group" role="presentation">Popular destinations</li>';  // app.js:337
// and app.js:343 for 'All destinations'
```

These are direct children of `ul#country-listbox[role="listbox"]` (`index.html:134`, `keystone/index.html:135`). ARIA 1.2 permits only `option` and `group` as owned elements of `listbox`; `role="presentation"` strips the `li` semantics and leaves a bare text node as a listbox child, which AT in listbox-reading mode generally does not surface.

**Impact.** The visual grouping that justifies the custom control — a curated five-corridor shortlist above the full alphabet — is not programmatically determinable. A screen-reader user arrowing the list hears "Mexico MXN, 1 of 47" with no indication that the first rows are a shortlist.

**Fix.** Restructure each section as a real group that owns its options. In `comboRender`, emit `<li role="group" aria-label="Popular destinations"><ul role="none" class="combo__group-list">` + option rows + `</ul></li>`, and the same for "All destinations". Keep the visible header text in a `<span class="combo__group" aria-hidden="true">` inside the group element so it is not announced twice. Required supporting CSS changes:

- add `.combo__group-list { list-style: none; margin: 0; padding: 0; }` — and give the emitted `<ul>` that class, or the nested list inherits UA defaults (`list-style: disc`, `padding-inline-start: 40px`) and every country row gets a bullet and an indent. `.combo__list` (`styles.css:537`) is a plain class selector and does not cascade to a nested list.
- add `display: block` to `.combo__group` (`styles.css:538-544`) — it currently sets `padding: 10px 14px 6px` on an `li`; moving the class to a `<span>` makes it inline, where vertical padding does not affect layout height and the headers collide with adjacent rows.
- delete `styles.css:545` (`.combo__group + .combo__group`) — already dead code today, and permanently so after the restructure.
- keep the existing `pop.length` / `rest.length` guards at `app.js:336` and `342`, so an empty labelled group is never emitted.
- keep the `aria-label` text byte-identical to the visible string, in case the two are ever localized separately (2.5.3).

The existing JS survives unchanged: `app.js:349` uses `combo.list.querySelectorAll(".combo__opt")` and the delegated handlers at `app.js:425/429` use `closest(".combo__opt")`, both descendant-based, and `aria-activedescendant` may legitimately target a nested descendant.

> **Verification notes.** Downgraded from High. Two claims in the original did not hold: AT does **not** fold the header into a neighbouring option's name (an option's accessible name computes from its own subtree, `app.js:326-333`; a sibling text node cannot leak in) — the realistic failure is silent omission. And nothing is functionally broken: only `role="option"` children count for posinset/setsize, so "1 of 47" is reported correctly, every option stays reachable, correctly named and operable. What is lost is supplementary context on a list whose option names are self-describing and fully searchable. Separately verified clean: `.combo__group` text is `#63615E` on `#FEFDFC` = 6.08:1, passing 4.5:1 even at 0.72rem. **Lower-churn alternative** if the restructure feels heavy: wrap only the popular block in a `role="group"` and leave the "All destinations" rows as direct listbox children — less symmetric, roughly half the diff, still makes the shortlist programmatically determinable.

---

#### A11Y-04 — After filtering, no option is active: `aria-activedescendant` is cleared and Enter silently does nothing

- **WCAG:** APG Combobox pattern (list-autocomplete). Contributes to the 4.1.3 gap in A11Y-05.
- **Component:** `app.js:350`
- **Effort:** S

**Evidence.**

```js
comboSetActive(comboRows.findIndex(function (el) {
  return Number(el.getAttribute("data-index")) === selected;
}));   // returns -1 whenever the selected destination is filtered out
```

Every keystroke re-runs `comboRender` via the input handler at `app.js:408`. When the query excludes the currently selected country, `findIndex` returns -1, `comboSetActive(-1)` takes the `else` branch at `app.js:360-362` and **removes** `aria-activedescendant`, and `comboActive` stays -1. Enter at `app.js:414-418` then calls `e.preventDefault()` and resolves `comboRows[-1]` to `undefined`, so the keystroke is swallowed with no feedback. There is no form ancestor, so not even an implicit submit. `styles.css:560-561` confirms `.is-active` is the only highlight, so sighted keyboard users also see nothing highlighted.

**Impact.** The user types the exact country name, presses Enter, and the widget does nothing — the control appears broken. They have to discover that an extra ArrowDown is required first.

**Fix.** Make the first match active whenever filtering leaves the selection out of view. Replace the call at `app.js:350`:

```js
var want = comboRows.findIndex(function (el) {
  return Number(el.getAttribute("data-index")) === selected;
});
comboSetActive(comboRows.length ? (want === -1 ? 0 : want) : -1);
```

and at `app.js:416` use `var el = comboRows[comboActive] || comboRows[0];`.

`comboRows` is a real array built from `.combo__opt` only (`app.js:349`), so presentational group headers are excluded and index 0 is always a real option; `findIndex` is already used at `app.js:307`. The `comboRows.length ? … : -1` guard correctly keeps the empty state free of a dangling `aria-activedescendant`. Because this combobox can only commit list values (no free-text value), auto-highlighting the top match is the APG "automatic selection" variant and does not override the user's typed text.

> **Verification notes.** Downgraded from High: the 4.1.2 mapping does not hold — omitting `aria-activedescendant` when no option is active is valid ARIA, and APG explicitly permits a manual-selection list-autocomplete combobox with no auto-highlight. The closer normative hook is **4.1.3** for the unannounced result count, tracked as A11Y-05. The original's "total silence" claim is also wrong — screen readers echo typed characters; what is missing is *results* feedback. ArrowDown-then-Enter still works (`Math.min(-1+1, len-1) = 0`), so the control stays keyboard-operable and 2.1.1 is met. The original's secondary suggestion (special-case Enter when exactly one row exists) is arbitrary and becomes dead code once the main fix lands — dropped. **Also worth folding in:** `aria-selected="true"` stays pinned to the committed destination (`app.js:327`) while `aria-activedescendant` moves, so arrowing through results announces options as not-selected while an unhighlighted row claims selection. Moving `aria-selected` onto the active option in `comboSetActive` (keeping the check SVG as the committed-value affordance) is what actually matches the APG examples. Smoke-test in a short embedded iframe afterwards: `comboSetActive` calls `scrollIntoView` (`app.js:359`) on every keystroke; `block: "nearest"` should contain it, but verify it does not scroll the host page.

---

#### A11Y-05 — Nothing in the widget is a live region: the filtered result count, the empty state and the recalculated quote are all silent

- **WCAG:** 4.1.3 Status Messages (AA)
- **Component:** `app.js:348`; `index.html:135`, `keystone/index.html:136`
- **Effort:** S
- *Raised independently by the ARIA-semantics and keyboard-focus passes; merged.*

**Evidence.**

```js
if (combo.empty) combo.empty.hidden = (pop.length + rest.length) > 0;   // app.js:348
```

```html
<p class="combo__empty" id="country-empty" hidden>No destinations match that search.</p>
```

`grep -rn 'aria-live|role="status"|role="alert"|aria-atomic|sr-only|visually-hidden|aria-describedby'` across `app.js`, `styles.css`, `index.html` and `keystone/index.html` returns **zero hits**. There is no live region and no screen-reader-only utility class anywhere. `#country-empty` is a plain `<p>`, not referenced by `aria-describedby` on `#country-search` (`index.html:130-132`); unhiding it is a purely visual change. Content that merely transitions out of `hidden` is not announced by a region that is not live.

Zero-result path traced by hand: `html = ""` → `combo.list.innerHTML = ""` → `comboRows = []` → `comboSetActive(-1)` removes `aria-activedescendant` → ArrowDown computes `Math.min(-1+1, -1) = -1` and re-sets -1 forever. The user gets silence on the keystroke, silence from the removed activedescendant, and silence on every subsequent arrow press. There is no native-select fallback to lean on: once `.combo--ready` is added (`app.js:397`), `#country` is `tabindex="-1" aria-hidden="true"` and `display: none`.

**Impact.** As a screen-reader user types, the number of matches changes silently — no "12 destinations available". When the query matches nothing, they hear nothing at all and are left pressing ArrowDown against an empty list with no idea the search failed, unable to distinguish "this corridor is not supported" from "the widget is broken". Narrowing 50 destinations to 1 is equally silent on the success path.

**Fix.** Two separate nodes — one visible empty-state paragraph, one visually-hidden status region. Do not conflate them.

HTML, in both files, after the `</ul>`:

```html
<p class="combo__empty" id="country-empty"></p>
<p class="pm-sr-only" id="country-status" role="status"></p>
```

CSS (`styles.css`, near line 563) — the `.pm-sr-only` utility genuinely does not exist today:

```css
.combo__empty:empty { display: none; }
.pm-sr-only { position:absolute; width:1px; height:1px; margin:-1px; padding:0;
  overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0; }
```

JS — register `status: $("country-status")` in the `combo` object literal (`app.js:278-287`), then replace `app.js:348`:

```js
var n = pop.length + rest.length;
if (combo.empty)  combo.empty.textContent  = n ? "" : "No destinations match that search.";
if (combo.status) combo.status.textContent = n
  ? (n + (n === 1 ? " destination" : " destinations") + " available")
  : "No destinations match that search.";
```

Gate the **status** write to filter changes only — pass a flag from the `input` handler at `app.js:408` rather than writing on every `comboRender` call — and debounce it (~150ms) so fast typists do not queue one announcement per keystroke.

> **Verification notes — the originally proposed fix had three defects, two of which would ship broken code.**
> 1. **The proposed JS snippet throws and kills the combobox.** `app.js` is strict mode (`"use strict";` at `app.js:14`) and the snippet used a bare, undeclared `status.textContent = …`. `status` resolves to `window.status`, still a string in all major browsers; assigning a property to a primitive under strict mode throws (`TypeError: Cannot create property 'textContent' on string ''`). Since `comboRender` runs on every `input` event, that would throw on **every keystroke** and break filtering entirely. Hence the explicit `combo.status` binding above.
> 2. **Reusing the region for the quote update is a silent no-op.** One raiser suggested the same region also carry the receive-amount update from `app.js:177`. That region sits inside `#country-panel`, which is `display: none` (`styles.css:455`) except when open, and the quote updates while the combobox is **closed** (`comboChoose` calls `comboClose(true)` at `app.js:393` before the `change` listener fires). Live regions in `display:none` subtrees do not fire. A quote announcement needs its own region **outside** `#country-panel`, near the receive field — track it separately.
> 3. **The on-open count will be swallowed.** `comboOpen` un-hides the panel (`app.js:377`) and calls `comboRender` (`app.js:379`) in the same synchronous task, so the region enters the a11y tree already populated — browsers treat that as initial content, not a mutation. Do not fight it with delays; write an empty string on open and let the first real keystroke carry the count.
>
> Also: `role="status"` plus `aria-live="polite"` together is redundant but harmless. **Drop the 3.3.1 Error Identification citation** one raiser attached — a search returning no matches is not an "input error", and 3.3.1's actual requirement (identify and describe the error in text) is already met by the visible paragraph. This is 4.1.3 only. The "Enter becomes a dead key" framing is also overstated as an independent defect: swallowing Enter with no active option is APG-acceptable and there is no form to submit — it is covered by A11Y-04. Held at Medium rather than raised: selection remains possible (clearing the query restores the list), so this degrades and confuses rather than blocks. Held at Medium rather than lowered: this is money-adjacent, the empty state feels unrecoverable, and a dead ArrowDown with no feedback is a real abandonment risk.

**Depends on:** A11Y-04 — without that fix, the new status region is the only feedback a typing user ever gets, because `aria-activedescendant` is being removed on the success path too.

---

#### A11Y-06 — No forced-colors support anywhere: active-option and selected-method states vanish in Windows High Contrast

- **WCAG:** n/a — no WCAG 2.2 success criterion governs user-agent color override. Inclusive-design / robustness defect.
- **Component:** `styles.css` (component-wide); concretely `styles.css:560-561`, `604-608`, `478-482`, `530-535`, `425-428`, `443`
- **Effort:** M

**Evidence.** `grep -rn "forced-colors\|forced-color-adjust\|prefers-contrast\|-ms-high-contrast"` over the whole repo returns nothing (exit 1). The state indicators are expressed purely as author colors, all of which the UA overrides in forced-colors mode:

```css
.combo__opt.is-active, .combo__opt:hover { background: var(--pm-meridian-lightest); }   /* 560-561 */
.calc__methods button.active { border-color: …; background: …; color: …; }              /* 604-608 */
```

`border-width` and `border-style` are identical between `.calc__methods button` (`styles.css:591-603`, `1.5px solid`) and `.active`, so nothing survives. The review under-stated the scope: `styles.css:478-482` (`.combo__trigger:focus-visible`) and `styles.css:530-535` (`.combo__search input:focus`) both set `outline: none` and replace the ring with a `box-shadow`, which forced-colors drops entirely — so those focus rings vanish too. The global `:focus-visible { outline: 3px solid … }` at `styles.css:103` survives (outline-color is forced to a system color), so only the opted-out controls break.

**Impact.** A Windows High Contrast user gets no active-row indicator in the destination list and cannot tell which delivery method is selected — the method drives the quoted fee and ETA. The widget is embedded on third-party FI pages with no control over the host environment, so this is the kind of item an infosec/engineering review will flag. Both host pages share one stylesheet (`index.html:14`, `keystone/index.html:14`), so a single block fixes both.

**Fix.** Append **after** the base rules (media queries add no specificity, so source order decides) — note the `:hover` selector is included, since `styles.css:560` is a grouped selector and re-expressing only `.is-active` would strip pointer users' hover affordance:

```css
@media (forced-colors: active) {
  .combo__opt.is-active,
  .combo__opt:hover {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .combo__opt.is-active .name,
  .combo__opt.is-active .code,
  .combo__opt.is-active .check { color: HighlightText; }

  .calc__methods button.active {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
    border-color: Highlight;
  }

  .combo__trigger:focus-visible,
  .combo__search input:focus,
  .field__control:focus-within {
    outline: 3px solid Highlight;
    outline-offset: 2px;
  }
}
```

The explicit `.name` / `.code` / `.check` child overrides are necessary precisely because `forced-color-adjust: none` makes the element responsible for its descendants' colors.

> **Verification notes.** Downgraded from High on the **citation**, not the facts: 1.4.1 and 1.4.11 are evaluated against the content as authored and delivered, not under a UA color override, and WCAG 2.2 has no forced-colors criterion. Labelling this an AA failure in a review framed "Target: WCAG 2.2 AA" overstates the conformance claim. (The genuine 1.4.11 exposure lives in the default rendering and is A11Y-02 — do not double-count it here.) The impact on the combobox half was also overstated: `CHECK_SVG` uses `stroke="currentColor"` (`app.js:290-291`) and `styles.css:558` sets `.combo__opt .check { color: var(--pm-meridian) }`, which resolves to CanvasText in forced-colors — so the **selected** row stays identifiable and "every row renders identically" is not accurate; only the **active** keyboard-cursor row is invisible. The claim that HCM users are the population most likely to rely on the keyboard path is rhetorical — HCM users are primarily low-vision/light-sensitive sighted users, and the screen-reader path here is intact. The **methods half is fully confirmed and is the stronger part**: notably the authors already handled `.is-unavailable` with non-color cues (`styles.css:612-624`: `border-style: dashed` plus a `::after "· unavailable"` string, both of which survive forced-colors), so the `.active` gap is an inconsistency in their own approach. One raiser proposed `outline: 3px solid CanvasText` for focus; `Highlight` is the better keyword — `CanvasText` conflates focus with ordinary text/border color.

**Related:** A11Y-02 (its fix already carries a forced-colors block for the active option), A11Y-12, A11Y-14. Consider fixing these four as one forced-colors pass.

---

#### A11Y-07 — Search field at 15.2px triggers iOS Safari auto-zoom on every open, zooming the host FI page

- **WCAG:** n/a — iOS platform behavior. (The original cited "1.4.10 Reflow — related"; no success criterion is actually failed, and WCAG affirmatively protects the ability to zoom.)
- **Component:** `styles.css:523`
- **Effort:** S

**Evidence.** `.combo__search input { font-size: 0.95rem; }` (`styles.css:520-531`). `rem` resolves against the **root** `html` element, which is never given a font-size in `styles.css` or `keystone/keystone-theme.css` — `body` is 17px (`styles.css:79`) but that is irrelevant — so root stays at the 16px UA default and 0.95rem computes to **15.2px**. iOS Safari auto-zooms any focused text input below 16px. `comboOpen()` calls `combo.search.focus()` unconditionally at `app.js:380`, reached from the trigger's click handler at `app.js:400-402`, so a tap fires it every time.

This is the **only** sub-16px focusable text input in the widget — the amount input is 1.45rem/23.2px (`styles.css:434-440`) and the native select is 1.1rem (`styles.css:445`) — so the fix as scoped is complete.

**Impact.** Every tap of the destination control on an iPhone magnifies the page. Inside an iframe, the zoom applies to the top-level FI landing page, which the widget's own viewport meta does not govern and cannot reset — the user is left zoomed in with the widget partly off-screen and has to pinch out after each open. On a money-adjacent rate quote this reads as the page breaking.

**Fix.** `styles.css:523` → `font-size: 1rem;`

Prefer `1rem` over a hard `16px`: they are identical today (root is unset), but a hard pin ignores a user who has raised their browser's default font size, while `1rem` scales with it. The resulting 0.8px difference from the 0.95rem option rows (`styles.css:553`) is imperceptible — do **not** let a later cleanup "harmonize" the input back down or bump the option rows up; option rows are not focusable inputs.

Separately, as hardening (not part of the verified defect): add `autocorrect="off" autocapitalize="none"` to `#country-search` (`index.html:130`, `keystone/index.html:131`). `spellcheck="false"` is already present and does **not** govern iOS autocorrect, which is the separate non-standard `autocorrect` attribute. The scenario where autocorrect substitutes mid-search and empties the list is plausible for multi-word names ("Dominican Republic", "Côte d'Ivoire") but was not demonstrated.

> **Verification notes.** Downgraded from High purely on calibration: no success criterion is failed (the finding's own `wcag` field conceded this), the control remains fully operable while zoomed, and it affects all iPhone users equally rather than creating a disability-specific barrier. In a review targeting WCAG 2.2 AA, "high" should be reserved for genuine SC failures and operability blockers. The arithmetic was the non-obvious part and the raiser got it right — a sloppier reviewer would have computed 0.95 × 17 = 16.15px and wrongly dismissed it. Minor citation imprecision: the original called `keystone/index.html:5` "the widget's own `<meta viewport>`"; `keystone/index.html` is actually a full host demo page, not an embed document. The embed argument still holds for the real deployment.

**Related:** A11Y-18 (the keyboard this focus call summons), A11Y-11 (the panel height it compounds).

---

### Low

#### A11Y-08 — Trigger advertises `aria-haspopup="listbox"` but opens a composite panel, and owns no `aria-controls`

- **WCAG:** APG Combobox patterns. (Not a 4.1.2 failure — see note.)
- **Component:** `index.html:121-122`, `keystone/index.html:122-123`
- **Effort:** S

**Evidence.** The trigger declares `aria-haspopup="listbox" aria-expanded="false" aria-labelledby="dest-label country-value"` with no `aria-controls`. `#country-panel` (`index.html:127`) is an unroled `<div>` containing **both** `#country-search` (`role="combobox"`) and `#country-listbox`. Per ARIA 1.2 the popup element should bear the role the `aria-haspopup` value names, so the attribute is untrue of the popup.

**Impact.** A screen-reader user told "has popup listbox, collapsed" expects to arrow through options; instead focus lands in a text field. The mental model has to be rebuilt. Nothing is unreachable — the panel is the trigger's immediate DOM sibling inside `#country-combo`.

**Fix.** Make the attribute truthful and keep the button a button:

- `index.html:122`, `keystone/index.html:123` — replace `aria-haspopup="listbox"` with `aria-haspopup="dialog" aria-controls="country-panel"`
- `index.html:127`, `keystone/index.html:128` — `<div class="combo__panel" id="country-panel" role="dialog" aria-label="Choose a destination" hidden>`
- leave `#country-search` and `#country-listbox` untouched

> **Verification notes — the originally proposed fix was rejected.** It recommended putting `role="combobox"` on `#country-trigger`, which yields a combobox whose popup contains **another** `role="combobox"` (`#country-search`) — two nested comboboxes for one control, more confusing than the status quo. It also strips the button role while leaving `aria-labelledby="dest-label country-value"` intact, so the selected value folds into the accessible *name* and the combobox exposes no *value* at all; APG's select-only combobox does the opposite. The APG shape being gestured at (date-picker combobox) puts `role="combobox"` on a text input, not a popup button. `aria-modal="false"` is the default and adds nothing. **Downgraded from Medium:** every 4.1.2 requirement is satisfied on the trigger — role (implicit button), name ("Destination, Mexico (MXN)"), state (`aria-expanded`, correctly toggled at `app.js:376/385`). Only the `aria-haspopup` *value* is wrong, and APG is non-normative. The original's "no announcement of the structural change" is false: focus lands on `#country-search`, which carries `aria-label="Search destinations"`, `role="combobox"` and `aria-autocomplete="list"`, all announced on the focus move. `aria-controls` is honored only by JAWS via a dedicated key and is required by no SC.

> **Adjacent issue found during verification, outside this finding's scope and stronger than it:** `app.js:420` handles Tab with `comboClose(false)`, which sets `hidden` on the panel containing the focused element before the browser resolves the Tab. See A11Y-19's note — and note that the keyboard pass separately verified Tab/Shift+Tab landing correctly in Chrome, so this needs a cross-browser check rather than a blind fix.

---

#### A11Y-09 — The "no-JS fallback" `<select>` is a false promise: it ships empty, `aria-hidden` and `tabindex="-1"`

- **WCAG:** n/a — code-honesty / graceful-degradation defect. (The original cited 2.1.1, 4.1.2 and 1.3.1; none hold — see note.)
- **Component:** `index.html:137-138`, `keystone/index.html:138-139`
- **Effort:** S (comment fix) / M (real fallback)
- *Raised independently by the ARIA-semantics and mobile/embed passes; merged.*

**Evidence.**

```html
<!-- State + no-JS fallback; the combobox above is the accessible UI. -->
<select id="country" class="combo__native" tabindex="-1" aria-hidden="true"></select>
```

Zero `<option>` elements in the markup. `populateCountries` (`app.js:261-270`) is the only thing that fills it, and it runs from `startLive` (`app.js:624`) / `startFallback` (`app.js:593`), both downstream of the `fetch("/api/corridors")` at `app.js:629`. `styles.css:455-457` confirms the progressive-enhancement wiring: `.combo__trigger, .combo__panel { display: none }` by default; `.combo--ready` flips the select to `display: none` and the custom control on. The select's only `<label>` points at `for="country-trigger"` — a button that is `display:none` in the pre-JS state — so the visible select has no accessible name either.

**Impact.** The comment advertises a guarantee the markup does not deliver, which will mislead the next engineer and any automated scan. No user is affected: with JS the attributes are inert (the element is `display:none` from `app.js:397` onward, already out of the a11y tree and tab order); without JS the entire widget is dead — `#receive-amount` renders "—" (`index.html:151`), `#rate-line` renders "—" (`index.html:157`), the method tiles have no handlers, and there is no `<noscript>` anywhere.

**Fix.** In priority order:

1. **Do this.** Stop advertising a fallback that does not exist. Replace the comment at `index.html:137` / `keystone/index.html:138` with something accurate: `<!-- Selection state for the combobox above; hidden from AT because the combobox is the accessible UI. Requires JS — see populateCountries(). -->`. Leave `tabindex="-1" aria-hidden="true"` exactly where they are.
2. **Optional.** Add a `<noscript>` block inside the calculator card explaining that live rates require JavaScript, with a link to the full transfer flow. This addresses the whole dead widget, not just the select.
3. **Only if a genuinely usable non-JS control is wanted.** Server-render the `<option>` list (inline the `FALLBACK` table from `app.js:19-32` at build time, or render from the tenant corridor table), give the select its own label, **and then** move `tabindex="-1" aria-hidden="true"` into the `.combo--ready` block at `app.js:397`.

> **Verification notes — the originally proposed fix would regress the exact scenario it targets.** Both raisers recommended removing the attributes from markup and setting them in JS at `app.js:397`. Done **without** step 3's server-rendered options — which is what both proposed as the primary action — that inserts a focusable, `aria-label`ed, **zero-option** select into the tab order in precisely the JS-blocked state it claims to protect. A screen-reader user who currently skips a dead element silently would instead land on "Destination, combo box, 0 items" and be stuck. It also creates a real exposure window on every normal load where none meaningfully exists today (the script is synchronous at end of body, `index.html:508`). Adding `aria-label="Destination"` duplicates the visible label at `index.html:119`. **Downgraded from Medium/Critical:** 2.1.1 governs *functionality* and there is none (empty select, no change listener, nothing downstream would react); 1.3.1 is a stretch, no relationship is misconveyed; only 4.1.2 is arguable, and only for a control conveying nothing. WCAG conformance is assessed against the technologies a page relies on, and relying on scripting is permitted. One raiser's CSP premise is also overstated for this repo: `netlify.toml:35` sets only `Content-Security-Policy: frame-ancestors 'self'` — no `script-src` — and the future design (`docs/architecture-azure-embed-widget.md:59`) specifies `script-src 'self'`, which permits the widget's own same-origin bundle. The "/embed server-render" route is a phase-4 blueprint (`docs/…:47,59,189`), not an "M"-effort change in this static Netlify repo; if it is built, the server-rendered list must carry only country name + currency (stable), never rates (hourly sweep), because `/embed` is edge-cached per tenant.

---

#### A11Y-10 — ArrowUp on the collapsed trigger does not open the popup and scrolls the page instead

- **WCAG:** APG Combobox — Keyboard Interaction. Not a WCAG failure (2.1.1 is satisfied; three other opening keys work).
- **Component:** `app.js:403-405`
- **Effort:** S

**Evidence.**

```js
combo.trigger.addEventListener("keydown", function (e) {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); comboOpen(); }
});
```

This is the only keydown handler on the trigger (`grep keydown app.js` returns exactly two hits: 403 the trigger, 409 the search input). ArrowUp falls through unhandled and un-preventDefaulted, so the browser performs its default scroll. Verified live: with the trigger focused and the combo closed, ArrowUp left `data-open === "false"`, `activeElement` still `country-trigger`, and `window.scrollY` moved by -40px. Nothing handles it elsewhere — no document-level key listener, and `select#country` is `tabindex="-1" aria-hidden="true"` so its native behavior is unreachable.

**Impact.** Keyboard and screen-reader users carry native-`<select>` muscle memory that Up and Down both open a dropdown, and NVDA/JAWS documentation teaches exactly that. The key does nothing to the widget and scrolls the document instead, with no feedback that the key was wrong.

**Fix.** Add ArrowUp to the existing condition and change nothing else:

```js
combo.trigger.addEventListener("keydown", function (e) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    comboOpen();
  }
});
```

> **Verification notes.** Two corrections to the evidence: **Alt+ArrowDown already works** — the condition tests `e.key` only and ignores modifiers, so it matches the ArrowDown branch today; only ArrowUp is broken. And the iframe-scroll consequence is overstated: a 40px scroll only occurs if the widget document is taller than the frame and already scrolled, and the trigger sits near the top of the form. **The originally proposed fix was rejected** — it added `var alt = e.altKey` and jumped the active option to `comboRows.length - 1`. That (a) makes Alt+ArrowUp *open* the popup, which APG does not specify (Alt+Up is the pattern's *close-and-return-focus* key), and (b) fights the component's own design: `comboRender` ends by pointing `comboSetActive` at the current selection, so a user on "Mexico (MXN)" pressing ArrowUp would land on the last alphabetical destination, scrolled far from their selection, in a 100+ row list. APG's "last option" guidance is written for a select-only combobox with no search field; this popup opens with a focused search input, where landing on the selected option is better and still conforming. The existing `preventDefault` still suppresses the button's native Space-on-keyup and Enter-on-keydown activation, so adding ArrowUp does not reintroduce a double-toggle. Out of scope: printable-character typeahead on the collapsed trigger, which APG also specifies, is likewise absent.

---

#### A11Y-11 — Dropdown panel opens downward only with a fixed 264px list and no collision handling

- **WCAG:** n/a — not a 1.4.10 Reflow failure (see note). Ergonomic polish.
- **Component:** `styles.css:496-507`, `styles.css:537`; `app.js:373-381`
- **Effort:** M

**Evidence.** `.combo__panel { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40; overflow: hidden; }` and `.combo__list { max-height: 264px; overflow-y: auto; }`. `comboOpen()` only sets `data-open="true"`, unhides, renders and focuses — no space measurement, no flip-to-top, no viewport-derived max-height. Measured panel height in a real browser at a 480×520 viewport: **331px**, always below the trigger. `docs/architecture-azure-embed-widget.md:85-86` specifies `height="520"` / `min-height:480px` for the embed.

**Impact.** In the documented ~520px frame the Destination field sits roughly mid-card, so a 331px panel opens mostly below the fold and pointer users must scroll the frame after opening.

**Fix.** Make the list height viewport-relative: `.combo__list { max-height: min(264px, 40vh); }` at `styles.css:537`. Inside an iframe, `vh` resolves against the iframe viewport, which is the right reference. Optionally add flip-up: compare `combo.trigger.getBoundingClientRect().bottom` against `window.innerHeight` (both already viewport-relative inside an iframe), set `data-drop="up"` on `.combo`, and add `.combo[data-drop="up"] .combo__panel { top: auto; bottom: calc(100% + 6px); }`.

> **Verification notes — the impact claim was disproven by testing, and half the fix was rejected.** "Because the iframe cannot scroll to content it does not know about, the option list is simply clipped" is not how iframes work — the iframe hosts its own document, which scrolls its own overflow independently. The ancestor chain from `#country-panel` was walked: the only non-visible overflow is `body { overflow-x: hidden; overflow-y: auto }`. (The combo lives in `.calcband`, **not** `.hero`; `.hero` does have `overflow: hidden` at `styles.css:309` but is not an ancestor.) An isolated repro with exactly this geometry produced `scrollHeight` 460→820, `maxScrollTop` 300, and the panel fully reachable after scrolling — a scrollbar, not a clip. (`overflow-x: hidden` with `overflow-y` visible computes the y axis to `auto`; confirmed empirically.) Keyboard users are additionally covered by `scrollIntoView({block:"nearest"})` at `app.js:359`. **1.4.10 is the wrong criterion**: the panel is `left: 0; right: 0`, pinned to field width, introducing zero horizontal overflow, and vertical scrolling is explicitly permitted. "At 200% zoom every dimension doubles" is also backwards — `max-height: 264px` is unchanged by zoom; the viewport shrinks in CSS px. **Rejected:** the proposal to clamp the panel's max-height to the measured available space. In the documented 520px embed, space below the trigger is ~140px, leaving a list box of ~90px — two visible rows — in exactly the short-frame, high-zoom case the finding is about. That trades one scroll gesture for a two-row list, worse for the low-vision users named as the affected group. If flip-up is implemented, clamp to the *larger* side with a floor around 200px and let the frame scroll past it. Two smaller issues with the proposal: it measures once in `comboOpen()` and never re-measures, though the architecture doc (lines 64, 99-101) has the widget posting a resize height the parent applies, so the decision can go stale — re-measure on `resize` while open; and "no inline styles… so this stays CSP-clean" is loose — setting `el.style.maxHeight` is a CSSOM mutation that is in practice not blocked by `style-src`, but the sentence reads as if inline style attributes are generally safe under the strict CSP this widget targets, which they are not. Prefer a custom property consumed by the stylesheet.

---

#### A11Y-12 — Delivery-method selected state has no non-color cue, so it collapses entirely in forced colors

- **WCAG:** 1.4.1 Use of Color (A) — **passes** in normal rendering (see note). Forced-colors gap only.
- **Component:** `styles.css:591-608`
- **Effort:** S

**Evidence.** The only declarations differing between `.calc__methods button` and `.active` are `border-color`, `background` and `color`. `border-width` is 1.5px in both, padding (`9px 6px`) and `font-weight` (700) identical. `renderMethods` toggles only the `.active` class — no icon, no checkmark, no text change.

Recomputed ratios for the state change:

| Pair | Ratio |
|---|---|
| border `#E7E5E2` → `#4451F6` | **4.45:1** |
| text `#63615E` → `#120F0D` | **3.09:1** |
| background `#FEFDFC` → `#ECEEFE` | 1.13:1 |

**Impact.** In normal rendering, two of the three changes are large **luminance** changes — which is exactly what deuteranopes and protanopes perceive normally — and both clear 3:1, the threshold WCAG's own G183 uses as the point where a distinction stops being "color alone". Desaturate the widget and the selected tile still reads. In **forced-colors** mode, however, `border-color`, `background` and `color` are all replaced by the system palette and all three cues collapse at once, leaving no selected state.

**Fix.** Add a cue that survives the forced-colors palette. `border-width` is one of the few properties that does (unlike `box-shadow`, which implementations strip):

```css
.calc__methods button.active { border-width: 2.5px; padding: 8px 5px; }
```

The padding compensation is required — these are `flex: 1` items with fixed `padding: 9px 6px`, so growing the border 1px per side shrinks the content box and shifts the label on selection. Roll the forced-colors declarations into the single block in A11Y-06 rather than duplicating a media query.

> **Verification notes.** Downgraded from High: the original's stated impact ("cannot tell whether Bank account, Debit card deposit or Cash pickup is currently selected") is not supported by the arithmetic above — only the *background* change is hue-only. Forced-colors support is not itself an AA success criterion, so what remains is narrow. **The fix's secondary suggestions need care:** "rendered in `renderMethods` alongside the existing textContent" is not possible as written — `app.js:448` does `btn.textContent = …`, which replaces all child nodes; an icon requires `appendChild` or `innerHTML`, and must carry `aria-hidden="true"` or it is announced as noise on top of whatever ARIA state is added. Do **not** reach for `box-shadow: inset` instead of `border-width` — that defeats the forced-colors purpose. And do not "upgrade" these tiles to `role="radiogroup"`/`role="radio"` without roving tabindex and arrow handling — see A11Y-01.

**Note:** the **real** defect at these lines is A11Y-01 (no `aria-pressed`), which this visual patch does not address. The original finding demoted that to a parenthetical while leading with a color claim the math does not support.

---

#### A11Y-13 — The search input's only boundary is a 1.24:1 border, inside a panel of the same fill

- **WCAG:** 1.4.11 Non-text Contrast (AA)
- **Component:** `styles.css:522-531` (primary); `styles.css:591-603` (secondary)
- **Effort:** S

**Evidence.** `--pm-gray-100 #E7E5E2` on `--pm-white #FEFDFC` = **1.237:1**; on `--pm-snow #F8F6F3` = **1.165:1**. `--pm-snow` against `--pm-white` = **1.062:1**, so the fill does not help either. `.combo__search input` is an empty text field on `--pm-white`, inside a `--pm-white` panel, whose only delimiter is a 1.5px `#E7E5E2` border. For an empty input the boundary *is* the identifying information, so 3:1 applies and is missed by a factor of ~2.4. `.calc__methods button` is the weaker secondary case: white fill on the white `.calc` card (`styles.css:380`) = 1.00:1, with the same 1.24:1 border.

**Fix.** Introduce a `--pm-border-control` token and apply it to the controls that actually fail. **The value the original recommended fails:** `#949291` computes to 3.049:1 on `--pm-white` but only **2.872:1** on `--pm-snow` — below 3:1 on exactly the fill `.field__control` uses. Use **`#8F8D8A`** (3.07:1 on snow, 3.26:1 on white; keeps the warm-gray cast of the `--pm-gray-*` ramp) or `#8E8E8E` (3.04:1 / 3.22:1).

Scope:
- `styles.css:527` (`.combo__search input`) — **required**; this is the real defect
- `styles.css:598` (`.calc__methods button`) — recommended; also consider a `--pm-snow` fill on unselected tiles so they differ from the card by more than 1.00:1
- `styles.css:420` (`.field__control`) — optional, consistency only (see note)
- `styles.css:466` (`.combo__native`) — **drop from the fix list**; the element is `display:none` whenever JS runs and empty/`aria-hidden`/`tabindex="-1"` when it does not

Leave `--pm-gray-100` for purely decorative separators (`.calc__lines`), where 1.4.11 does not apply.

> **Verification notes.** Downgraded from Medium. The original's headline — that the **combobox trigger** "reads as a line of static text" — is contradicted by its own markup: `index.html:121-126` contains a chevron SVG at `--pm-gray-600`, and `#63615E` on `#F8F6F3` = **5.72:1**, plus a bold `--pm-black` value at 17.7:1. 1.4.11 requires 3:1 on "the visual information required to identify" the control; it does not mandate a bordered hit area when another indicator identifies it, and a downward chevron is the conventional dropdown affordance. The trigger is defensible at AA. The no-JS claim at `styles.css:466` is a false positive for the reasons in A11Y-09. So: one clear AA failure on a secondary control inside an already-opened panel, one arguable one, one defensible control, one non-issue.

---

#### A11Y-14 — Trigger and search focus indicators suppress the global 3px outline for a 1.5px border tint and a 1.13:1 glow

- **WCAG:** Passes 1.4.11 (see note). 2.4.13 Focus Appearance is AAA — informational. Forced-colors gap is the real defect.
- **Component:** `styles.css:478-482`, `532-535`, `425-428`, `443`
- **Effort:** S

**Evidence.**

```css
.combo__trigger:focus-visible { outline: none; border-color: var(--pm-meridian);
  box-shadow: 0 0 0 3px var(--pm-meridian-lightest); }
```

This suppresses the global `:focus-visible { outline: 3px solid var(--pm-meridian); outline-offset: 2px; }` at `styles.css:103-105`. What remains is a 1.5px border recolored `#E7E5E2` → `#4451F6`, plus a 3px `#ECEEFE` halo at **1.13:1** against the card — contributing no perceivable area. Same pattern at `styles.css:532-535` (search input) and `styles.css:425-428` (`.field__control:focus-within`, with `outline: none` on the inner control at `:443`).

**Impact.** On contrast grounds this **passes AA**: the focused border is 5.19:1 against the `--pm-snow` fill it encloses, and the focused-vs-unfocused border change is 4.45:1 — both over 3:1. The genuine defects are (a) 1.5px of recolored hairline is a thin indicator where 2px+ is wanted, and (b) `box-shadow` is dropped entirely under `forced-colors: active` while `outline` is not, so these controls have **no focus indicator at all** in Windows High Contrast.

**Fix.** Stop suppressing the outline; layer it. Replace `outline: none` with `outline: 3px solid var(--pm-meridian); outline-offset: 2px;`, keep the border-color change as a secondary cue, and drop the 1.13:1 halo. Apply as a **unit** across `.combo__trigger:focus-visible`, `.combo__search input` (both the `outline: none` at `styles.css:530` and the `:focus` rule at `:532`), and `.field__control` — either by dropping `outline: none` from the `.field__control input, .field__control select` rule at `:443`, or by adding the outline to `.field__control:focus-within` at `:425-428`.

> **Verification notes.** Downgraded from Medium: the finding disproves its own severity in its own impact field — it lists an AA criterion then concedes it is not an AA failure, and 2.4.13 is explicitly AAA/out of scope. Its "tab order through the widget becomes visually inconsistent" rationale also does not survive reading the sibling control: `#send-amount`'s `.field__control` uses the identical border + 1.13:1 halo treatment, so **within the widget** the trigger's indicator is consistent, not uniquely weak. The inconsistency exists only against the surrounding marketing page — and the stated deployment is an iframe embed where the widget is the entire document. **Two defects in the proposed fix:** it touches only the trigger and search input, never `styles.css:443` or `425-428`, so applying it as written manufactures the exact inconsistency it complains about, inverted (3px outline on the trigger, 1.5px hairline on the sibling amount field). And "apply the same to `.combo__search input:focus`" targets `:focus`, not `:focus-visible`, so a 3px outline would fire on mouse click into the box — defensible for a search field, but an unacknowledged behavior change; use `:focus-visible` for parity. **Geometry verified and it fits, narrowly:** `.combo__panel` is `top: calc(100% + 6px)`, and a 3px outline at 2px offset extends 5px past the trigger's border box, leaving 1px clearance; inside the panel, `.combo__search`'s 12px padding absorbs the 5px against `.combo__panel { overflow: hidden }` (`styles.css:506`). If anyone later tightens that 6px gap or the 12px padding, the indicator clips.

**Related:** A11Y-06.

---

#### A11Y-15 — Search placeholder is unstyled, so its contrast is whatever the embedder's browser defaults to

- **WCAG:** 1.4.3 Contrast (Minimum) (AA)
- **Component:** `index.html:132`, `keystone/index.html:133`, `__embedtest.html:44`; fix belongs in `styles.css`
- **Effort:** S

**Evidence.** `grep -rn placeholder` over the repo returns three HTML hits and **zero CSS hits** — there is no `::placeholder` rule in `styles.css` or `keystone/keystone-theme.css`. `styles.css:520-531` sets `color: var(--pm-black)` on `background: var(--pm-white)` for `.combo__search input` with no placeholder override, and there is no `prefers-color-scheme`, `data-theme` or `forced-colors` block anywhere, so the rendered placeholder color is purely a UA default composited over `#120F0D` on `#FEFDFC`.

Recomputed: a UA opacity of 0.54 composites to `#7F7C7B` = **4.076:1**, under the 4.5:1 bar. A lighter default composites to roughly `#91908E` = **3.139:1**. Older Chrome's `darkGray #A9A9A9` = 2.313:1.

**Impact.** The placeholder is the only *visible* description of the search field — the real label is `aria-label`-only — so sighted users have the magnifier icon and this string. The contrast is outside the team's control today, which is a poor property for an embeddable going into infosec review. Placeholder text is in scope for 1.4.3: it is not invisible, decorative, or part of an inactive component.

**Fix.**

```css
.combo__search input::placeholder { color: var(--pm-gray-600); opacity: 1; }
```

`--pm-gray-600 #63615E` on `--pm-white #FEFDFC` = **6.076:1**. The `opacity: 1` reset is genuinely required, not cargo-cult: Firefox's UA stylesheet applies `opacity: 0.54` to `::placeholder` and would otherwise multiply it on top of the author color. Because all three entry points load the same `styles.css`, one rule covers all of them; no per-file edit is needed.

> **Verification notes.** Downgraded from Medium: no information or function is lost — the field's purpose is conveyed redundantly by the magnifier icon (`styles.css:511-519`), by the fact that the user deliberately opened a destination panel, and by the full country list rendered immediately beneath. The programmatic name is intact, so AT users are unaffected. The worst realistic shortfall is 4.08 vs 4.5 on hint text. **Do not quote the per-engine breakdown** in the ticket: current Chromium uses `color-mix(in srgb, currentColor 54%, transparent)` for `::placeholder` and lands on the same 4.08:1 as Firefox, not the passing 4.54:1 the finding claimed — so the "two of three engines" framing is probably wrong in the finding's own favour, and more importantly it was reached by guessing at UA internals. The defensible claim is the simple one: unstyled, therefore UA-dependent, therefore below 4.5:1 in real engines. The secondary suggestion (a visible label or persistent hint, since the placeholder vanishes on type) is sound but is a separate 3.3.2/usability item — do not bundle it into this contrast fix.

---

#### A11Y-16 — Selected destination truncates with an ellipsis at narrow width, with no other way to read it

- **WCAG:** 1.4.4 Resize Text (AA) — arguable, under text-only zoom. **Not** a 1.4.10 failure.
- **Component:** `styles.css:484-492`
- **Effort:** S

**Evidence.** `.combo__value { flex: 1; font-weight: 700; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`, holding the string built at `app.js:369` (`d.name + " (" + d.ccy + ")"`). The flag (`styles.css:483`) and 18px chevron (`:493`) are both `flex: none`, so all compression lands on `.combo__value`.

Width arithmetic at a 320px iframe: 320 − 36 (`.container` padding-inline 18px×2, `styles.css:1251`) − 52 (`.calc` padding 26px×2) − 3 (1.5px border×2) − 32 (`.field__control` padding) − ~20 flag − 18 chevron − 20 (two 10px gaps) ≈ **139px** for text at 1.1rem/700 ≈ 14–15 characters. "Dominican Republic (DOP)" is 24. Long names are realistic, not hypothetical: `startLive()` (`app.js:611-627`) takes names straight from `/api/corridors`.

**Impact.** A clipped "Dominican Repub…" still identifies the country in nearly all cases; it becomes ambiguous only for a handful of live-API names (Dominica vs Dominican Republic, the three Guineas, the two Congos). Screen-reader users are unaffected — `aria-labelledby="dest-label country-value"` computes from the DOM text, which is the full untruncated string.

**Fix.**

```css
.combo__value { flex: 1; min-width: 0; font-weight: 700; font-size: 1.1rem;
  color: var(--pm-black); overflow-wrap: break-word; }
```

`min-width: 0` is the standard flex guard and also prevents a long unbroken token forcing overflow. Both markup copies share `styles.css`, so one change covers them; no JS edit needed.

> **Verification notes.** Downgraded from Medium: the central impact claim is false. The original says the currency code "is the first thing lost" and "the full value exists nowhere else on screen." The destination currency is echoed **twice more in the same card, untruncated** — `#receive-ccy` (set at `app.js:198/219`) and `#rate-line` (set at `app.js:200` to "1 USD = 17.15 MXN"), rendered directly below the trigger, neither with nowrap/ellipsis. And 1.4.10 is a misattribution: Reflow is about two-dimensional scrolling at 320 CSS px, and text that fits by truncating does not trigger it. 1.4.4 is arguable rather than clear-cut — under **full-page** zoom (the default in Chrome/Safari/Edge, and what the "zoomed to read it" user is almost certainly using) every length scales together and the truncation ratio is unchanged; the failure materializes only under text-only zoom, today a Firefox-specific setting. **Two corrections to the fix:** drop the proposed `align-items: flex-start` — `.combo__trigger` inherits `align-items: center` from `.field__control` (`styles.css:417`), and overriding it pins the flag and chevron to the top of a two-line box, which looks broken in the overwhelmingly common one-line case. And **do not ship the `title` fallback** the original offered "at minimum": title text is unreachable by keyboard and by touch, so it does not satisfy 1.4.4, and offering it invites a reviewer to pick the non-remedy.

---

#### A11Y-17 — Scrolling option list has no `overscroll-behavior`, so touch flicks chain out into the host page

- **WCAG:** n/a — touch usability
- **Component:** `styles.css:537`
- **Effort:** S

**Evidence.** `.combo__list { list-style: none; margin: 0; padding: 6px 0; max-height: 264px; overflow-y: auto; }` with no `overscroll-behavior` anywhere in the file (grep over all 1,258 lines returns nothing), so the computed value is the `auto` default. The list always scrolls: 13 fallback destinations (`app.js:19-32`) deduped against `used[i]` give 13 `.combo__opt` rows plus 2 headers; at ~42px per row that is ~616px of content in a 264px box — it scrolls on every open, with any configuration, and far more so with the live corridor list.

**Impact.** Flicking past the top or bottom of the destination list continues into the widget document and, from an iframe, can drag the page underneath. Nothing is lost — scrolling does not close the panel (only outside click, Escape and Tab do), the panel is `position: absolute` so it travels with the trigger, and `select.value` is untouched until Enter/click — so the worst outcome is a disorienting flick.

**Fix.** `.combo__list { overscroll-behavior: contain; }` — `contain`, not `none`, so the local rubber-band/glow is preserved. Pure CSS, no ARIA impact.

For the bare embeddable widget document, the complete fix is at document level rather than panel level: give its `html, body` `overscroll-behavior: contain`, which stops any chain out of the frame regardless of where the flick starts, including on the search input.

> **Verification notes.** Downgraded from Medium: no SC is implicated (the finding concedes `n/a`), there is no AT, keyboard or screen-reader consequence, and the headline cross-frame harm is the weakest part — scroll chaining across an iframe boundary is browser- and origin-dependent, and the two documents that actually exist in this repo are full-length landing pages hosting the widget inline, not bare embed documents. The iframe embed is prospective per the architecture doc, so the finding states the most severe variant as if verified. **Correction to the second half of the fix:** the stated rationale for also adding the property to `.combo__panel` is wrong — group headers are rendered *inside* `#country-listbox` (`app.js:337/343`), so a flick starting on a header already lands in `.combo__list`. Only the search row sits outside. And `.combo__panel` is `overflow: hidden` with no overflowing content, so the property is likely a no-op there. **Noted in passing, out of scope:** `.nav.open .nav__menu` (`styles.css:1227-1228`) is a second scrolling popup with the same gap.

---

#### A11Y-18 — Panel auto-focuses the search field on touch, summoning the keyboard over an already-short panel

- **WCAG:** n/a — mobile usability. (2.4.11 Focus Not Obscured scopes to author-created content; an on-screen keyboard is UA chrome.)
- **Component:** `app.js:380`
- **Effort:** M

**Evidence.** `comboOpen()` ends with `if (combo.search) combo.search.focus();` unconditionally, reached from the trigger's click handler (`app.js:400-402`), which fires on tap. Because the call sits inside a trusted user gesture, iOS honors it and the keyboard appears.

**Impact.** Every tap raises the software keyboard, covering roughly 45% of a phone screen, on top of the panel-height issue in A11Y-11. iOS does not resize an iframe's layout viewport when the keyboard appears, so the widget cannot detect or compensate. The primary mobile gesture here is tapping a Popular destination, not typing.

**Fix.** Keep DOM focus on the search input and suppress the keyboard instead of relocating focus:

```js
function comboOpen(fromKeyboard) {
  // …
  if (combo.search) {
    var coarse = !fromKeyboard && window.matchMedia &&
                 window.matchMedia("(pointer: coarse)").matches;
    if (coarse) combo.search.setAttribute("inputmode", "none");
    else combo.search.removeAttribute("inputmode");
    combo.search.focus();
  }
}

combo.search.addEventListener("pointerdown", function () {
  combo.search.removeAttribute("inputmode");
});
```

`inputmode="none"` is honored by iOS Safari and Chrome on Android: the element is focused, the caret is live, hardware-keyboard input still works, but the virtual keyboard is not summoned. Pass `true` from the keyboard path at `app.js:403-405` and nothing from the click path at `app.js:400-402`. Gate on `(pointer: coarse)` rather than negating `(pointer: fine)` so a touchscreen laptop with a mouse keeps today's behavior. Apply to both markup copies.

> **Verification notes — the originally proposed fix is unsound on two independent counts and must not ship.**
> 1. **Invalid ARIA.** It said "the existing `aria-activedescendant` wiring can be moved to the trigger unchanged." It cannot: `aria-activedescendant` is supported only on `application`, `combobox`, `group`, `textbox` and the composite roles. `#country-trigger` is a plain `<button aria-haspopup="listbox">`; `button` is not in that list, so the attribute would be ignored. The fix removes it from the one element where it is valid — `#country-search`, which carries `role="combobox"` — and parks it where it does nothing. Active-option announcement would silently stop working.
> 2. **It creates a keyboard-trap-equivalent.** All list navigation lives on the search input's keydown handler (`app.js:409-421`). The trigger's own handler (`app.js:403-405`) has three branches that all call `comboOpen()`, which resets `combo.search.value = ""` and re-renders. So with DOM focus left on the trigger and the panel open, ArrowDown re-opens and wipes the list, Enter re-opens instead of selecting, and Escape does nothing. On a hybrid device where `pointer: coarse` matches but a keyboard is attached (iPad with Magic Keyboard, touchscreen Windows laptop used by touch), opening by tap would make the panel entirely unoperable by keyboard — a genuine 2.1.1 failure and a net regression.
>
> Downgraded from Medium: moving focus into a newly revealed panel is what the APG combobox examples do, and it is what makes the panel discoverable to VoiceOver/TalkBack — who also match `pointer: coarse`, so a naive gate would strip the helpful behavior from the AT users who depend on it. The stated impact also leans on A11Y-11 for most of its weight, double-counting a defect reported elsewhere.

**Sequencing:** fix A11Y-11 first; much of the perceived severity here disappears with it, and it is worth re-evaluating whether this is worth the code at all.

---

#### A11Y-19 — Outside-tap-to-close is delegated on `document`, which iOS Safari may not fire for taps on non-interactive elements

- **WCAG:** n/a — APG dismissal / touch usability. Hardening.
- **Component:** `app.js:432-434`
- **Effort:** S

**Evidence.**

```js
document.addEventListener("click", function (e) {
  if (comboIsOpen() && !combo.root.contains(e.target)) comboClose(false);
});
```

The only outside-dismissal path. No `pointerdown`/`touchstart` companion, and confirmed by grep: no `cursor: pointer` on `body`, `.card` or `.calc__lines`, and no backdrop element — so the surrounding markup is not "clickable" for iOS's purposes.

**Impact.** Narrower than it first appears. `.combo__panel` is positioned at `top: calc(100% + 6px)` — it drops **below** the trigger and never covers it, so the trigger stays visible with a rotated chevron, is natively clickable (the iOS quirk does not apply), and its handler at `app.js:400-402` toggles close. Tapping any other control (the amount input, the method tiles) dispatches a real click that bubbles to `document` and closes the panel. The failing set is taps on inert chrome only. No focus trap; the user is never stuck.

**Fix.** Add a `pointerdown` listener on `document` alongside the existing click listener, reusing the same `!combo.root.contains(e.target)` check. It is harmless and idempotent — `comboClose` is safe to call twice, and the open-tap on the trigger is inside `combo.root` so it cannot self-close.

> **Verification notes — the secondary suggestion is a regression and must be dropped.** The original also proposed "a `focusout` handler on `combo.root` that closes when `relatedTarget` is outside the panel." That breaks destination selection outright: the `<li class="combo__opt">` rows (`app.js:322-330`) are not focusable, so a press on one blurs `#country-search` with `relatedTarget === null`, which that rule classifies as outside. `comboClose` (`app.js:382-388`) sets `data-open="false"`, and `styles.css:507` then resolves the panel to `display: none` **before mouseup**, so the click handler at `app.js:427` never fires and mouse/touch selection stops working entirely. A `focusout` net would have to ignore null `relatedTarget`, or defer via `setTimeout` and test `document.activeElement` / a pointerdown-inside flag. The underlying WebKit premise is also unverified — the finding concedes "worth confirming on a real device," and WebKit's synthetic-click dispatch has changed repeatedly across iOS versions. **Its incidental point about Tab is valid and is a separate item:** `app.js:420` closes on Tab keydown, hiding the focused search input before the browser computes the next focusable, which can scatter focus. Note this contradicts the keyboard pass's live Chrome result (focus landed correctly on the next control) — so it needs a cross-browser manual check, not a speculative fix. See **Residual risk**.

---

### Info

#### A11Y-20 — `aria-expanded="true"` is hardcoded on the search input and never updated

- **WCAG:** n/a — hygiene / maintenance. (Not a 4.1.2 failure; no AT user is currently given wrong information.)
- **Component:** `index.html:130`, `keystone/index.html:131`
- **Effort:** S

**Evidence.** `<input type="text" id="country-search" role="combobox" aria-expanded="true" aria-controls="country-listbox" aria-autocomplete="list">`. `aria-expanded` is written only at `app.js:376/385` (on `combo.trigger`) and `app.js:615/620` (nav toggle) — **no code path ever writes it on `combo.search`**.

**Impact.** Latent. While closed, the input sits inside `#country-panel`, which is `display: none` from both `styles.css:455` and the `hidden` attribute (`app.js:386`), kept in lockstep with `data-open` — so it is absent from the accessibility tree and the stale value is never announced. While open, "true" is correct. The real defect is that widget state lives in markup with no code owning it: any future change that keeps the input reachable while collapsed ships a wrong state with no code to fix.

**Fix.** Set `aria-expanded="false"` in both HTML files, then mirror the trigger exactly — `combo.search.setAttribute("aria-expanded", "true")` next to `app.js:376` and `"false"` next to `app.js:385`.

> **Verification notes — two of the three proposed writes were rejected.** (a) Setting it to `String((pop.length + rest.length) > 0)` at the end of `comboRender` would make `#country-search` report "false" while `#country-trigger` still reports "true" (the panel is still visible and `comboClose` was not called) — two elements of the same widget contradicting each other, and contradicting the DOM, where `ul#country-listbox` is still displayed. Per ARIA 1.2, `aria-expanded` reports whether the popup is *displayed*, and it is. It would also be immediately overwritten in `comboOpen`. **Do not touch it in `comboRender`.** (b) Clearing `aria-activedescendant` in `comboClose` is redundant — `app.js:360-361` already removes it whenever no row is active, and `comboOpen` always re-renders, so no stale reference survives a close/reopen cycle. Downgraded from Low: the zero-results "misstatement" the finding leaned on does not occur as described, and the stated failure mode (arrowing into an announced-as-open empty listbox) is impossible — the arrow handlers clamp against an empty `comboRows` and no-op.

**The gap this finding brushed past is A11Y-05**, which is worth considerably more.

---

#### A11Y-21 — At 320px the option row squeezes the country name into a ~98px column

- **WCAG:** n/a — no 2D scrolling results, so 1.4.10 is not failed. Density/polish.
- **Component:** `styles.css:379-384`, `547-554`
- **Effort:** S

**Evidence.** Measured at a true 320px viewport on `index.html`: `.calc` 284px, `.combo__panel` 230px, `.combo__opt` 228px, `.combo__opt .code` 34.59px, row height 42.31px. Injecting "Democratic Republic of the Congo" grew the row to **90.94px**, so only ~3 rows fit the 264px list. Cause: fixed padding that never relaxes — `.calc` keeps `padding: 26px` at every breakpoint (the only `.calc` rules in media queries, `styles.css:1182` and `:1203`, set max-width/justify-self only), and `.combo__opt` keeps `9px 14px`. No horizontal overflow (`list.scrollWidth === clientWidth === 228`; `documentElement.scrollWidth === innerWidth === 320`). The long-name premise is legitimate: `netlify/functions/corridors.mjs:58` passes `country.name` straight through from the live ReadyRemit response, so 30+ character ISO names are reachable (the bundled `FALLBACK` table tops out at "United Kingdom", so this never shows in the offline demo).

**Impact.** Cosmetic. Nothing is clipped or truncated — the name wraps and stays fully readable, the popular-destinations block pinned at the top is all short names, and a search input sits above the list so a long-named corridor is reachable by typing rather than scrolling.

**Fix.** Append at the **end** of `styles.css` (after the existing responsive block at line 1258 — same specificity as the base `.calc` rule at `:379`, so source order decides):

```css
@media (max-width: 400px) {
  .calc { padding: 18px; }
  .combo__opt { padding: 9px 12px; gap: 8px; }
}
```

Measured effect: panel 230→246px, selected-row name column 98.41→142.52px, unselected rows drop from 3 lines to 2. Re-check the amount field and `.calc__methods` at 320px afterwards, since `.calc { padding: 18px }` is widget-wide.

> **Verification notes — half the proposed fix is actively harmful and must be dropped.** `.combo__opt .code { min-width: 0 }` was applied and measured: the box collapsed to 14.9px while the text still painted 28.4px wide, and since `.code` has `overflow: visible` and nothing clips it, "CDF" **overran the check icon by 5.5px** — currency text painted on top of the selected-state checkmark. "CDF"/"MXN" is a single unbreakable token and cannot compress; `min-width: 0` only lets the box lie about its size. Baseline, `.code` never shrank precisely *because* `min-width: auto` floors a flex item at min-content. Leave it alone. If the remaining wrap on the selected row still matters, take the finding's own fallback instead: inside the same breakpoint, `.combo__opt { flex-wrap: wrap }` so the code moves to a second line. Two measurement corrections: the long name wraps to **3** lines, not four; and "name column 98.4px" is the **selected** row only (98.41px is what remains after the 16px check SVG plus its 10px gap) — unselected rows measure 133.69px, so the finding presents the worst single row as the general case.

---

## Verified sound

The following were checked explicitly and found correct. They are listed so reviewers can see coverage, and so a later refactor does not silently undo them.

### ARIA semantics

- **Option accessible names are correct and non-redundant.** The flag emoji span is `aria-hidden` (`app.js:328`) and the inline check SVG is `aria-hidden` (`app.js:290`), so each option announces "Mexico MXN, selected, 3 of 42" rather than leaking an emoji name or a duplicate "check" cue.
- **Selection is conveyed programmatically**, with `aria-selected` on every option (`app.js:327`) — not by the check glyph or color alone.
- **The trigger's accessible name computes correctly** from `aria-labelledby="dest-label country-value"` (`index.html:122`). `#country-value` is a descendant of the button, which is explicitly permitted; the name resolves to "Destination, Select a destination" before selection and "Destination, Mexico (MXN)" after. **2.5.3 Label in Name is satisfied** — the visible text "Destination" is the first token of the name.
- **`<label for="country-trigger">` on a `<button>` is valid HTML** — `button` is a labelable element — and `aria-labelledby` takes precedence in name computation anyway, so there is no conflict or double announcement.
- **`aria-activedescendant` referential integrity is sound where it is set.** IDs are generated as `dest-opt-N` from the destination index (`app.js:326`), are unique in the document, always point at a node present in the DOM at the moment the attribute is written (`app.js:358`), and the referenced option is a child of the listbox named by the input's `aria-controls` — exactly what ARIA 1.2 requires. The attribute is removed rather than left dangling when no row is active (`app.js:361`).
- **`aria-expanded` on the trigger never drifts.** `comboOpen` sets "true" (`app.js:376`), `comboClose` sets "false" (`app.js:385`), and `comboClose` is the single exit used by Escape, Tab, outside click, selection and the toggle click.
- **Selection feedback reaches the screen reader.** `comboChoose` dispatches `change` (`app.js:392`), the listener calls `comboSync` (`app.js:536`) which rewrites `#country-value`, and `comboClose(true)` returns focus to the trigger (`app.js:387`), so the new destination is announced via the refocused trigger's updated name.
- **The listbox is correctly typed and named** — `role="listbox"` with `aria-label="Destinations"` (`index.html:134`) — and single-select is correctly implied (no `aria-multiselectable`, exactly one `aria-selected="true"`).

### Keyboard & focus

*(All items below were confirmed with real key injection on the live page, not by reading code.)*

- **Tab from the search input closes the panel and lands on the next control after the combo**, not the top of the document. `app.js:420` calls `comboClose(false)` with no `preventDefault`; focus landed on the "Bank account" method button and `data-open` flipped to false. The display:none-on-focused-element fixup does not beat Tab's default action **in Chrome**. *(See Residual risk — this is the one clean result that an adjacent static-review finding disputes, and it needs a cross-browser pass.)*
- **Shift+Tab from the search input** closes the panel and returns focus to `#country-trigger`.
- **No keyboard trap and, correctly, no focus trap.** The APG combobox pattern must not trap; Tab and Shift+Tab both escape cleanly and the panel closes behind them. Confirmed in both directions.
- **Space on the trigger opens the panel and does not scroll the page** — measured scroll delta of exactly 0 with the trigger mid-viewport (`app.js:404`, `e.key === " "` with `preventDefault`). Enter is likewise preventDefaulted, so neither key double-toggles via the synthesized button click at `app.js:400`.
- **Escape closes the panel and returns focus to the trigger** (`app.js:419`).
- **Focus is correctly moved into the search input on open** (`app.js:380`) and **returned to the trigger** on selection (`comboChoose` → `comboClose(true)`, `app.js:393`) and on Escape.
- **`aria-activedescendant` does not go stale when the filtered list empties.** `comboSetActive(-1)` takes the `else` branch at `app.js:360-362` and removes the attribute; verified by typing "zzzz" (0 options, `aria-activedescendant === null`). ArrowDown/ArrowUp/End on an empty list all clamp safely via the `Math.min`/`Math.max` guards. *(The adjacent defect is that nothing is announced — A11Y-05 — and that the active option is dropped on the non-empty path too — A11Y-04.)*
- **The display:none native select causes no focus problem.** It is never focused, never in the tab order, never in the a11y tree, and setting `.value` + dispatching `change` (`app.js:391-392`) works normally on a `display:none` select. The `.combo--ready` progressive-enhancement swap is sound.
- **All three delivery-method tiles are individually Tab-reachable and Enter/Space operable**, inheriting the global `:focus-visible` ring (`styles.css:103-107`; measured `solid 3px rgb(68,81,246)` at 2px offset, 5.52:1 on white). **2.1.1 is met** — their missing selected-state semantics (A11Y-01) are a screen-reader concern, not a keyboard one.
- **Home/End are wired** (`app.js:412-413`) and move the active option to first/last; **ArrowDown from `comboActive === -1` correctly lands on index 0** rather than skipping.
- **The trigger and search input each have a real focus indicator** that clears 1.4.11 on contrast grounds — measured `borderTopColor rgb(68,81,246)` + `boxShadow rgb(236,238,254) 0 0 0 3px`; `#4451F6` is 5.16:1 against the `#F8F6F3` inner fill and 5.52:1 against the `#FEFDFC` card. *(The thinness and the forced-colors gap are A11Y-14.)*

### Visual contrast & motion

- **Text contrast in the option rows passes 1.4.3 in every state.** `.combo__opt .name` (`#2E2C29`) is 13.70:1 on the panel and 12.08:1 on the hover/active fill; `.combo__opt .code` (`#63615E`) is 6.08:1 and 5.36:1; the selected row's name is promoted to `#120F0D` at 16.57:1. No AA text failure anywhere in the list.
- **Group headers are 6.08:1** — comfortably over 4.5:1 even at 0.72rem (~11.5px), which is below the large-text threshold and therefore correctly held to the 4.5:1 bar. The empty-state message is likewise 6.08:1.
- **Non-text contrast passes for every icon.** The chevron and search magnifier (`#63615E`) are 6.08:1 on white and 5.72:1 on snow; the selected check SVG (`#4451F6`) is 5.51:1 on the panel and 4.86:1 when the selected row is also the active row. All well over 3:1.
- **Selection — as distinct from the active/hover highlight — is not conveyed by color alone.** `app.js:331` injects `CHECK_SVG` into the selected row, so the selected destination carries a shape cue. That half of 1.4.1 is satisfied.
- **`prefers-reduced-motion` is honoured for the only animation that moves** — the infinite `calc-pulse` border animation on the receive field is disabled at `styles.css:586-588`. The chevron's `transition: transform 0.15s ease` is a 150ms, 18px, one-shot rotation; de minimis, and 2.3.3 is AAA. Deliberately not filed — adding it to the existing reduced-motion block is a nice-to-have.
- **No seizure risk.** `calc-pulse` runs at ~1.1Hz on a border *color* (not a luminance flash) and the `.amount.flash` opacity toggle is debounce-gated — both far under the 3Hz threshold of 2.3.1.

### Mobile, touch & embed

- **All touch targets clear 2.5.8 (24×24).** Measured at 390px: trigger 285×46, option rows 283×42.3, search input 40px tall, method buttons 94.7×50. Option rows sit just under the 44px practical guidance but are full-bleed horizontally with no adjacent targets, so there is no real mis-tap risk. The 18px chevron and search icon are decorative glyphs inside/behind larger targets (`styles.css:518` sets `pointer-events: none` on the search icon), not targets themselves.
- **Flag emoji are handled correctly for AT.** Every flag span carries `aria-hidden="true"` (`app.js:328`, `keystone/index.html:124`) and the trigger's name comes from `aria-labelledby`, so no flag is ever announced. Row height is driven by the 15.2px text, not the 18.4px emoji, so a platform with no flag glyphs (Windows renders regional-indicator pairs as boxed letter codes) degrades cosmetically only.
- **Pinch zoom is not blocked.** Neither viewport meta (`index.html:5`, `keystone/index.html:5`) contains `maximum-scale` or `user-scalable=no`, so a low-vision user can always zoom out of the iOS auto-zoom in A11Y-07. Clean against 1.4.4.
- **No horizontal page scroll from the combobox at 320px.** Measured `document.scrollWidth === 320` with the panel open, and `.combo__list` `scrollWidth === clientWidth` (228px) even after injecting a 32-character destination name — long names wrap rather than overflow. **No 1.4.10 failure on that axis.**
- **The trigger truncates without breaking layout.** `.combo__value`'s `overflow: hidden` also resolves its flex `min-width: auto` to 0, so it ellipsizes instead of pushing the chevron out of the button — avoiding the usual flexbox-nowrap overflow bug at 320px. *(Whether ellipsizing is the right behavior is A11Y-16.)*
- **The open panel obscuring the result is transient and self-correcting.** `comboChoose` (`app.js:389-394`) closes the panel and returns focus to the trigger, so the updated "Total to recipient" is on screen immediately after selection. **2.4.11 is not implicated by the selection flow.**
- **Panel stacking is sound inside the widget document** — `z-index: 40` with nothing else positioned or fixed that could overlap, and no `transform`/`filter` ancestor that would break the absolute containing block.

---

## Residual risk / manual testing still needed

This was a static and instrumented-browser review. The following cannot be settled from source and must be confirmed before the component is treated as AA-conformant in production.

**1. Real screen-reader passes.** Everything above about announcement is inferred from the accessibility tree and from ARIA specification behavior, not from listening. Needed: **NVDA + Firefox**, **JAWS + Chrome**, **VoiceOver + Safari** (macOS), and **VoiceOver on iOS**. Specifically verify —

- that the `aria-pressed` fix in A11Y-01 actually announces a state change on each tile press, in all four;
- that the `role="group"` restructure in A11Y-03 announces "Popular destinations, group" on entry with a correct per-group index, and does **not** double-announce the visible header;
- that the new polite status region in A11Y-05 is announced on filter changes **and not** swallowed on open, with the ~150ms debounce in place — live-region reliability is the single most implementation-variable area in ARIA, and the on-open suppression described there is a prediction, not a measurement;
- that `aria-activedescendant` announcements track correctly after the A11Y-04 fix, including whether moving `aria-selected` onto the active option (the APG-matching change noted there) reads better or worse than the current pinned-to-committed-value behavior. **This is a judgement call that only listening can settle.**
- JAWS specifically for the `aria-controls` change in A11Y-08, since JAWS is the only AT that exposes it.

**2. Real iOS and Android touch.** Simulators do not reproduce the two behaviors this review depends on most —

- **A11Y-07**'s auto-zoom, and that `font-size: 1rem` actually removes it on a physical iPhone inside a real cross-origin iframe;
- **A11Y-18**'s `inputmode="none"` behavior — that the keyboard genuinely does not appear, that the caret stays live, that VoiceOver/TalkBack still announce the panel on open, and that the `pointerdown` escape hatch restores typing on first tap;
- **A11Y-19**'s premise, which is explicitly unverified: whether current iOS Safari propagates `click` to `document` for taps on non-interactive elements. Test on at least two iOS major versions — WebKit's synthetic-click dispatch has changed repeatedly;
- **A11Y-17**'s overscroll chaining from inside a real iframe.

**3. Forced-colors / Windows High Contrast.** A11Y-06, A11Y-12 and A11Y-14 are all written against the specification's forced-colors behavior, and the `forced-color-adjust: none` + system-keyword technique needs confirming in a real Windows High Contrast session across the four supported themes — particularly that `Highlight`/`HighlightText` give adequate separation from `Canvas`/`CanvasText` in each, and that the A11Y-12 `border-width` cue (rather than `box-shadow`) survives as predicted. Also confirm there that the check SVG still renders via `currentColor`, which this review asserts but did not observe.

**4. Testing inside an actual client iframe.** Everything about the embed is currently inference from `docs/architecture-azure-embed-widget.md` plus two full-length host demo pages. **No bare embed document exists in this repo** — `__embedtest.html` contains no iframe. Until one does, the following remain untested:

- the A11Y-11 panel geometry at the documented `height="520"` / `min-height:480px`, including whether the `min(264px, 40vh)` cap and any flip-up behave correctly when the parent applies a posted resize height **while the panel is open**;
- whether a flick chains out of the frame to the FI page (A11Y-17), and whether the document-level `overscroll-behavior: contain` recommended there is sufficient;
- whether the iOS keyboard or auto-zoom affects the **top-level** page as A11Y-07 predicts;
- behavior under the tenant CSPs that will actually be served. Note that this repo's `netlify.toml:35` sets only `frame-ancestors 'self'` — the `script-src 'self'` assumed by A11Y-09's analysis is a design-document value, not a shipped header.

**5. One contested result.** The keyboard pass verified live in Chrome that **Tab from the search input lands on the next control** (listed under Verified sound). A static finding (noted under A11Y-19 and A11Y-08) argues that `app.js:420` hides the focused element before the browser resolves Tab, which should drop focus to `<body>` and restart tab order. Both cannot be right in every engine. **Re-test Tab and Shift+Tab out of the open panel in Firefox, Safari and Chrome before concluding either way** — and do not apply a speculative fix to `app.js:420` until a browser is found that actually misbehaves.

**6. Automated scanning.** No axe/Lighthouse/IBM Equal Access run was performed as part of this review. Run one after the High and Medium fixes land, mainly as a regression net — note that A11Y-09's `aria-hidden` + `tabindex="-1"` pairing is specifically what keeps the axe `aria-hidden-focus` rule quiet, so do not let a scanner-driven cleanup remove it without the server-rendered options described there.

**7. Live-data coverage.** The bundled `FALLBACK` table (`app.js:19-32`) tops out at "United Kingdom" (14 chars), so the long-name truncation and row-density behavior in A11Y-16 and A11Y-21 **never appear in the offline demo**. Test against the live `/api/corridors` response, or seed the fallback with a 30+ character name, before signing those off.