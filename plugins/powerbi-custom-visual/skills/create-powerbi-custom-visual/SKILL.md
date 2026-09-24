---
name: create-powerbi-custom-visual
description: Build any Power BI custom visual end to end, so it behaves like a native one — cross-filtering and highlighting, report-theme colours, on-object formatting that opens the right format card, a format pane that only shows what applies, and a jsdom render harness that proves it before it ships. Use when creating a new pbiviz visual, adding a capability to one, or fixing one that feels foreign next to native visuals. Covers the step-by-step build order, the toolchain versions that work, data roles and dataView reading, the formatting model (cards, groups, containers, per-item settings), the sub-selection API, layout with CSS grid, big DirectQuery data (one query, self filters, loading on demand), and the Desktop install and verification loop. Not for report-layer work (pages, native visuals) or semantic model work.
---

# Build a Power BI custom visual

A build order plus the traps that cost real time. Written so the only thing still needed is a description of
what the visual should show and do.

**The principle behind every rule here: a custom visual feels native only when it borrows the host's own
machinery.** Colours come from the host palette, selection goes through the selection manager, settings go
through the formatting model, the format pane is navigated through the sub-selection API. Anything invented
instead of borrowed looks and behaves like a stranger on the page.

Every rule was earned on production visuals: a paged, ranked table with on-object formatting and a map that
draws hundreds of thousands of locations from a billion-row DirectQuery model. Treat those as evidence, not
as the shape every visual should take.

---

## Step 0 — Settle the shape before writing code

Answer these first; each one decides a file.

| Question | Decides |
|---|---|
| What is one row of this visual? A category, a hierarchy, a matrix? | `dataRoles` + `dataViewMappings` |
| Which figures does the author drop in, and can there be several? | roles with `max`, and whether settings need to be per field |
| Does clicking something mean anything? | `supportsHighlight`, selection ids, context menu |
| Does it have parts an author would want to restyle? | on-object parts and the format cards behind them |
| What must survive a saved bookmark? | properties persisted with `persistProperties` |
| Does anything move by itself? | derive it from the clock, never from a counter started at load |

Then sketch the format cards **by job**, not by implementation. One card per thing a reader would name:
what it shows, how it is ordered, how it is coloured, how it is spaced.

## Step 1 — Scaffold that actually builds

```jsonc
// package.json — versions that work together
"dependencies": {
  "powerbi-visuals-api": "5.11.1",
  "powerbi-visuals-utils-formattingmodel": "6.0.4",
  "powerbi-visuals-utils-formattingutils": "6.1.2",   // PIN THIS
  "powerbi-visuals-utils-onobjectutils": "^6.0.3"     // only if you do on-object
},
"devDependencies": { "powerbi-visuals-tools": "^7.2.1", "typescript": "5.5.4", "jsdom": "^29.1.1" },
"scripts": { "package": "pbiviz package && node test/render.test.js" }
```

- **Pin formattingutils to 6.1.2.** 7.x ships an ES-module locales file the pbiviz localization loader
  cannot read ("Unexpected token 'export'"). Stay on 6.1.2, or package with `--all-locales`.
- **Never write project files with PowerShell `-Encoding utf8`** — it adds a BOM and webpack cannot parse a
  `package.json` with one.
- **Regenerate `package-lock.json` from a clean install** before pushing, or `npm ci` on a Linux agent fails
  with "Missing … from lock file".
- `Create certificate error: 'pwsh' is not recognized` is harmless; the package is still produced.
- ESLint's Power BI plugin forbids `innerHTML`; use `replaceChildren()`.
- File layout that keeps tests cheap: `src/data.ts` (pure functions, no DOM), `src/settings.ts` (formatting
  model), `src/visual.ts` (host wiring + rendering), `test/data.test.js`, `test/render.test.js`,
  `scripts/install-into-report.js`.

## Step 2 — capabilities.json

Data roles first, then the flags that buy native behaviour for free:

```jsonc
"supportsHighlight": true,          // other visuals' selections reach yours
"supportsKeyboardFocus": true,
"supportsMultiVisualSelection": true,
"supportsLandingPage": true,        // something to show before fields are dropped in
"sorting": { "default": {} },
"tooltips": { "supportedTypes": { "default": true, "canvas": true }, "roles": ["tooltips"] },
"supportsOnObjectFormatting": true, // step 8
"enablePointerEventsFormatMode": true
```

Every property used by the formatting model must also be declared under `objects` with the same object and
property name. A property missing here is silently never stored.

**The mapping decides how much data you get.** A categorical mapping with no reduction algorithm is capped
low by the host, and the visual then quietly shows part of the data while looking perfectly healthy:

```jsonc
"dataViewMappings": [{
  "conditions": [{ "category": { "max": 1 }, "image": { "max": 1 }, "barColor": { "max": 1 } }],
  "categorical": {
    "categories": { "select": [{ "for": { "in": "category" } }, { "for": { "in": "image" } }],
                    "dataReductionAlgorithm": { "top": { "count": 5000 } } },
    "values": { "select": [{ "for": { "in": "values" } }, { "for": { "in": "compare" } },
                           { "bind": { "to": "barColor" } }, { "for": { "in": "tooltips" } }] }
  }
}]
```

- `conditions` with `max: 1` is what stops an author dropping three fields into a role that means one thing.
- `for: { in: role }` takes every field in that role, in the order the author put them; `bind: { to: role }`
  takes exactly one. Roles read in the same order they were selected, which is how a second role (a value to
  compare against) can line up with the first by index.
- **Loading anything over the network needs a privilege**, or images silently fail:
  `"privileges": [{ "name": "WebAccess", "essential": false, "parameters": ["https://*"] }]`.
- `assets/icon.png` must exist (20x20) or packaging fails. The `guid` in `pbiviz.json` is the visual's
  identity: change it and every report that has it installed loses its visuals.

## Step 3 — Read the dataView into your own model

Convert once, at the top of `update`, into plain rows your renderer understands. Keep per-column metadata
(`source.queryName`, `source.objects`, `source.format`) — you need it later for per-field settings and for
number formatting.

- **Tell the host when you start and finish.** Wrap the body of `update` in
  `host.eventService.renderingStarted(options)` … `renderingFinished(options)`, and call
  `renderingFailed(options, String(e))` from a catch. Power BI uses this to know the visual is settled —
  export to PDF and PowerPoint waits for it — and an uncaught exception without it leaves the visual looking
  frozen with no clue why.
- **Say something useful when there is no data.** With `supportsLandingPage` the visual is shown before any
  field is dropped in; render a line that names the roles to fill ("Add a Rows field and at least one Values
  measure"). It doubles as the message when a query returns nothing.
- Format numbers with `valueFormatter.create({ format: source.format, cultureSelector: host.locale })`, so
  the model's own formatting is respected.
- **Display units only from 1,000 upward.** Handing the formatter a display unit for small numbers turns 6
  into "6.0". Pick the unit from the column's largest absolute value and only when it reaches a thousand.
- Highlights arrive as a parallel `highlights` array per value column; `null` means "not part of the current
  selection". Dim those rows rather than hiding them.
- Build a selection id per row: `host.createSelectionIdBuilder().withCategory(category, index).createSelectionId()`.

**Compute over the whole set, display a subset.** Anything derived — a rank, a share of total, a movement
against a comparison period, a maximum for scaling — is computed over every row. Only afterwards do you drop
rows for display (a search box, hiding empties, paging). Mixing the two produced three separate bugs in the
reference visual: a searched row was renumbered to 1, and its movement was measured against a list of one.

## Step 4 — The format pane

`FormattingSettingsService` from `powerbi-visuals-utils-formattingmodel`. This step decides whether an author
can find anything, so it deserves as much thought as the rendering.

### Cut the pane by job, not by implementation

One card per thing a reader would name out loud. A card called "Text" that holds the title font, the row
colours and the header switch is three jobs in a trench coat; split it. The reference visual ended up with
cards named Theme, Title, Rows and pages, Sorting, Search, Ranking, Bars, Comparison, Images, Columns and
spacing, Lines and shading, Totals and Text — every one of them a phrase an author would use.

Within a card, make a **section** whenever a group of settings has its own subject. Sections are what keep a
card of twelve settings readable, and they are what on-object navigation can jump to (step 8).

| Card | Sections |
|---|---|
| Title | Title · Subtitle |
| Text | Font · Row names · Values · Column headers |
| Rows and pages | Rows · Page navigation · Automatic paging |
| Bars | Bars · Size and shape |
| Columns and spacing | Row names · Value columns · Spacing |

### The on/off switch belongs at the top

A card or a section can carry a `topLevelSlice`. Power BI then renders it as the switch in the header, the
way native cards look, and greys out everything beneath it when it is off. Use it for anything with a
`show`-style toggle.

```ts
// A whole card behind one switch: SimpleCard, the toggle is not in `slices`
class SearchCard extends formattingSettings.SimpleCard {
    show = toggle("show", "Show a search box", false);
    placeholder = text("placeholder", "Text in the empty box", "Search");

    name = "search";                       // must equal the capabilities object name
    displayName = "Search";
    topLevelSlice = this.show;             // the switch in the card header
    slices = [this.placeholder];           // everything the switch governs
}
```

```ts
// A card with sections, and a switch on one of them: CompositeCard + Group
class RowsCard extends formattingSettings.CompositeCard {
    mode = dropdown("mode", "Show the rows as", [...], "pages");
    pageSize = num("pageSize", "Rows per page", 10, 1, 100);
    autoRotate = toggle("autoRotate", "Turn the pages by itself", false);
    intervalSeconds = num("intervalSeconds", "Seconds on each page", 8, 1, 600);

    name = "paging";
    displayName = "Rows and pages";
    groups = [
        new formattingSettings.Group({ name: "pagingRows", displayName: "Rows", slices: [this.mode, this.pageSize] }),
        new formattingSettings.Group({
            name: "pagingAuto", displayName: "Automatic paging",
            topLevelSlice: this.autoRotate,          // the switch heads this section only
            slices: [this.intervalSeconds],
        }),
    ];
}
```

**A switch that governs only part of a card is not that card's `topLevelSlice`.** "Horizontal lines between
rows" turns on one kind of line, not the whole Lines and shading card; making it the card switch would
promise something it does not do. It stays an ordinary toggle inside its section.

A card whose only content is its switch (a single opt-out like "Match the report theme") is fine as a plain
slice; a header switch with nothing under it reads as broken.

### Hide what cannot do anything

`onPreProcess()` runs just before the pane is built. Set `visible` there, on slices and on whole groups:

```ts
onPreProcess(): void {
    const scroll = this.isScroll;
    this.pageSize.visible = !scroll;         // no pages, no page size
    this.rowHeight.visible = scroll;         // only a scrolling list has a row height
    this.groups[1].visible = !scroll;        // page navigation
    this.groups[2].visible = !scroll;        // automatic paging
    this.showPageCount.visible = this.showPager.value;
}
```

Typical cases: a mode dropdown that makes a whole section meaningless, a colour that only matters once a line
is drawn, a placeholder with the search box off, styling for a value that is hidden. An author who never sees
a dead setting never wonders why it does nothing. Note that `topLevelSlice` already greys out what it
governs, so use `visible` for the settings a *different* choice makes irrelevant.

### Settings per field the author dropped in

A `container` renders as the native "Apply settings to" dropdown: one entry for all values plus one per
field, each with its own copy of the settings.

```ts
new formattingSettings.Group({
  name: "<group>",
  container: new formattingSettings.Container({
    displayName: "Apply the settings to",
    containerItems: [
      { displayName: "All values", slices: [...defaults] },
      ...columns.map(c => ({ displayName: c.name, slices: copiesWithSelector({ metadata: c.queryName }) })),
    ],
  }),
})
```

`ContainerItem` has **no constructor** — build plain objects and cast. Rebuild the items each update from the
columns. Power BI stores per-field values on the column, so read them back from
`dataView.categorical.values[i].source.objects` and fall back to the card's own values when a field has none.
That fallback is what makes "All values" behave like a default rather than a fourth option.

### The rest

- Identifiers the pane emits: `` `${card.name}-card` `` and `` `${group.name}-group` ``. Step 8 needs both.
- **Dropdowns whose choices come from the data** (which field drives sorting, which series to colour) are
  rebuilt each update from the column names; keep the stored value if it still exists, else fall back.
- **Changing a property's type orphans stored values.** Add a new property and read the old one as a fallback.
- Give a setting the value it really has. If a size or colour inherits from somewhere else, fill the control
  with the inherited value rather than showing 0 or a placeholder, and let a change override it.
- Write labels the way a product would: no internal shorthand, no jokes, units in the description rather than
  glued to the label ("Row height", description "In pixels.").
- Every property must also be declared in `capabilities.json` under the same object and property name, or it
  is silently never stored.

## Step 5 — Render

Whatever the visual draws, three things decide whether it feels native.

**Layout.** For anything table-like, one CSS grid; the track sizing is the whole game:

| Want | Track |
|---|---|
| As wide as the content **currently on screen**, capped | `fit-content(150px)` |
| Always as wide as the cap | `minmax(0, 150px)` |
| Exactly this wide, identical across copies of the visual | `150px` |
| Takes whatever is left, never disappears | `minmax(<floor>px, 1fr)` |
| Hugs its own content | `max-content` |

`minmax(0, max)` is not content-following: it grows to the cap whenever there is room. Exactly one track
should be `1fr`, or the row leaves a band of empty space; give that track a floor or long content squeezes it
out of existence.

**Viewport.** `options.viewport` changes on every resize; never cache a size across updates.

**Text.** Default to `Segoe UI` 10pt, which is what native tables use, and name the properties `fontFamily`
and `fontSize` exactly as native visuals do.

## Step 6 — Colours: follow the report theme

A custom visual **can** read the theme's colours and **cannot** read its fonts.

`host.colorPalette` is an `ISandboxExtendedColorPalette`: `foreground`, `foregroundNeutralSecondary`,
`foregroundNeutralTertiaryAlt`, `background`, `backgroundLight`, `positive`, `negative`,
`getColor(key)` for the theme's data colours, and `isHighContrast`.

Measured against native visuals in a real report, so you know which member to reach for:

| Native element | Colour | Palette member |
|---|---|---|
| Chart category labels and data labels | `#605E5C` | `foregroundNeutralSecondary` |
| Table text and headers | `#2A2A33` | the table's own default, not the theme foreground |
| That report's theme foreground | `#333333` | `foreground` |
| First series | theme data colour | `getColor("0")` |

**The pattern: the theme fills the default, the author's pick wins.** Resolving colours at render time from
the palette makes the colour pickers dead — the author changes one and nothing happens, and the pane shows a
colour that is not on screen. Instead, before rendering, fill each picker whose property was never persisted:

```ts
const objects = dataView?.metadata?.objects;
const set = (slice, objectName, propertyName, key) => {
    if (objects?.[objectName]?.[propertyName]) return;   // the author chose one; theirs wins
    const c = key === "data" ? pal.getColor("0") : pal[key];
    if (c?.value) slice.value = { value: c.value };
};
```

Offer one switch (`Match the report theme`, on by default) so a report can opt out.

- **High contrast**: text takes `foreground`, surfaces take `background`. A helper that hands the foreground
  to everything paints your shading solid black.
- **Do not ship a `visualStyles["<guid>"]` block in a report theme** for a visual that follows the theme: it
  arrives as a default and overrides the palette. That is how a visual ends up with black text while every
  native visual is grey.

## Step 7 — Interactions

- **Cross-filtering**: `selectionManager.select(id, multi)` with the row's selection id. With
  `supportsHighlight`, selections made elsewhere come back as `highlights`; dim the rest.
- **Paint the new state before the host confirms it.** Reading `getSelectionIds()` only after the promise
  resolves makes every click feel laggy. Compute the next selection yourself, render, then call `select`.
- **Re-render when the selection changes elsewhere**: `selectionManager.registerOnSelectCallback(() =>
  this.render())` in the constructor. Without it, clearing a selection in another visual leaves yours dimmed.
- **Draw a highlight, do not filter to it.** Keep every row on screen and show the highlighted share solid
  over a faint full shape, with the rows that have no share dimmed. Hiding the rest destroys the comparison
  the reader was making.
- A click on the background should clear the selection, and in a visual with its own controls each control
  stops the event so a click on the pager is not also a click on the data.
- **Context menu**: `selectionManager.showContextMenu(id, { x, y })` on `contextmenu`. This is also the route
  to drill-through.
- **Tooltips**: `host.tooltipService.show/move/hide` plus the `tooltips` capability gives report-page
  tooltips for free.
- **Page navigation is not available to a custom visual.** The API offers `launchUrl`, `drill` and
  `openModalDialog`, and nothing that switches report pages. Offer drill-through instead.
- **State that must survive** (a page the reader turned to, a sort they chose) goes through
  `host.persistProperties` into an object declared in capabilities, and is read back from
  `dataView.metadata.objects` on the next update.
- **Anything that moves by itself derives its state from the clock**, not from a counter started when the
  visual loaded: `state = f(Date.now())`, and wake on the boundary. Two copies of the visual then move
  together without knowing about each other. Let a reader take over — carry on from where they put it, and
  fall back in step at the next data update.

## Step 8 — On-object formatting

Clicking a part in format mode should open the pane on the card that governs it. Four things must line up,
and any one wrong makes it silently do nothing.

Use `HtmlSubSelectionHelper` from `powerbi-visuals-utils-onobjectutils`; see `reference/on-object.ts` for the
complete wiring.

1. **The card id needs the `Visual-` prefix**: `cardUid: \`Visual-${card}-card\``, and `groupUid:
   \`${group}-group\`` **without** one. Without the prefix the host cannot find your card and opens its own.
2. **Part names must be unique to your visual.** Never `title` — that is the host's own container object.
   Prefix them.
3. **The declared sub-selection type must match the styles you return.** Declare `Shape`, return Shape
   styles. A mismatch makes the host drop the whole answer, navigation included.
4. **Your own click handlers must step aside in format mode.** The helper listens on the root element and
   relies on bubbling; a `stopPropagation()` in a child handler kills it. In format mode: no selection, no
   sorting, nothing stopped.

Two more, about the DOM:

- **Mark the elements at the end of render**, after they have been rebuilt, or the new ones never carry the
  class and nothing highlights.
- **Do not rebuild the DOM on a sub-selection update.** Power BI calls `update` again the moment a part is
  sub-selected (`VisualUpdateType.FormattingSubSelectionChange`); rebuilding throws away the element the host
  is holding. Refresh the outlines and return.

## Step 9 — Prove it with a harness

Two files, no framework, and the render one runs as part of packaging:

- `test/data.test.js` — assertions over the pure functions in `src/data.ts`.
- `test/render.test.js` — loads the **packaged bundle** into jsdom with a fake host and pushes fake data
  views through `update()`. Copy `reference/render-harness.js`.

Assert behaviour, not shapes. Useful assertions for any visual:

- a click hands a selection id to the host
- two different palettes produce two different renders, and an author's own colour survives both
- every on-object part carries its class in format mode, clicks reach the root, and each navigate shortcut
  names a card the formatting model really emits
- a derived number (rank, share, total) is unchanged when rows are hidden from view
- the format pane builds without throwing for every configuration

**Avoid time-dependent tests**: a one-second interval fails now and then when the click lands on a boundary.

When something misbehaves only in the packaged bundle, **patch the bundle inside the probe** with a string
replace to add a log line instead of editing the source and rebuilding. Turns a two-minute loop into seconds.

## Step 10 — Install and verify in Desktop

Two loops, and they serve different moments.

**While building**, `pbiviz start` plus the Developer visual in Desktop reloads on every save. Fastest for
shaping a render, but the Developer visual is not the packaged one: it does not prove the format pane,
on-object or the install.

**Before believing anything**, the real loop:

```
close Desktop → node scripts/install-into-report.js <Report dir> → open the .pbip → bridge screenshot → look
```

The bridge needs Desktop's preview feature *external tool access via secure local APIs* switched on. There
are often two Desktop processes; always take the one whose `powerbi-desktop status` entry has a
`currentFilePath`.

- The installer **must refuse while Desktop is open**: Desktop rewrites `CustomVisuals/` from memory on every
  Ctrl+S and silently reverts an install made underneath it.
- **Pick the newest build by write time, not by name.** As text, `2.9.0` sorts after `2.10.0`, so a
  name-sorted installer ships an old build and you debug a version you did not build.
- **Open through the file association**, `Start-Process <file>.pbip`, exactly like a double-click, and leave
  about fifteen seconds after closing Desktop. Never start `bin\pbidesktop.exe` out of WindowsApps: the Store
  build is an MSIX app and without its package identity it cannot reach its token cache, so it looks signed in
  while every connection to the Power BI Service fails with "A connection could not be made to the data
  source … capacity or license issue" and live reports render nothing but errors.

### Clicking the security prompt yourself

Desktop **sometimes** shows *"Potential security risk — this file uses multiple data sources … Do you want to
open this file?"*. It does not always appear, so never wait for it; but while it is up nothing loads, the
bridge never connects, and an unattended run stalls on a window titled "Untitled - Power BI Desktop".

Confirming it is fine for your own project files: it is a routine prompt and it changes no setting. Never
auto-answer anything that weakens security for good or needs a person: "Ignore Privacy Levels", unencrypted
connection prompts, and any sign-in or credential dialog. Leave those and report them. Do not script
synthetic mouse input either; it is unnecessary and gets blocked.

The buttons are **not** in the UI Automation tree: the dialog body is an embedded Internet Explorer control
and its OK is a `<div role="button">`. So use UIA only to find the window, and the HTML document to press it:

1. Find the dialog: `AutomationElement.FromHandle(mainWindowHandle).FindAll(Descendants, NameProperty =
   'Potential security risk')`, then take `.Current.NativeWindowHandle`. **This works for both variants** —
   the dialog is sometimes a child of the main window and sometimes an owned top-level window that both
   `EnumChildWindows` and `EnumWindows` miss. Fall back to the main window handle if the element is absent.
2. `EnumChildWindows` that handle for class `Internet Explorer_Server`.
3. `RegisterWindowMessage("WM_HTML_GETOBJECT")` + `SendMessageTimeout`, then
   `oleacc.dll ObjectFromLresult` with IID_IHTMLDocument2 `{332C4425-26CB-11D0-B483-00C04FD90119}` to get the
   document.
4. Check `doc.body.innerText` really is this prompt, then walk `doc.all` for the element whose
   `getAttribute('role')` is `button` and whose `innerText` is `OK`, and call `.click()`.

Declare the Win32 imports with `CharSet.Unicode`, or every class name comes back as its first letter only and
you chase a phantom. The "Refresh now" banner and canvas elements **are** in the UIA tree, so those stay UIA
with an InvokePattern.

Ready-made: run `scripts/Confirm-OpenPrompt.ps1` in the background alongside any unattended Desktop work;
it watches for the prompt and confirms only that one.
- **Verify by rendering, then by measuring.** Take a bridge screenshot, then sample pixels to compare a
  colour against a native visual. "Looks about right" costs more time than any measurement.
- Data does not appear the moment the report opens; give it a minute before concluding a binding is broken.

## Step 11 — Big data: stay inside the host's limits

A visual that works on a sample can fail on the real model without a single error in its own code. These
held on a DirectQuery fact table of more than a billion rows:

- **A visual gets one query.** A second `dataViewMapping` makes Desktop fail to render the report as soon as
  its role is bound. Anything else the visual needs (reference shapes, lookup data) comes from the network
  or from the same query.
- **Keep DAX measures and Import-table columns out of a big query.** Either one stops the TOP-N being pushed
  down to the source: Power BI then fetches every group first and stops at the 1,000,000-row DirectQuery
  limit. Plain aggregations of fact columns, calculated columns on the DirectQuery table (a colour per status,
  a rounded coordinate) and Dual storage on the dimensions keep it pushed down.
- **When a measure is unavoidable, let it be blank where there is no data.** A measure that returns a
  default (say, grey) for empty groups keeps every group alive, including groups filtered away through a
  limited relationship, and the visual draws thousands of phantom rows.
- **Load detail on demand with a self filter.** Declare `general.selfFilter` (`{ "filter": { "selfFilter":
  true } }`) plus a `selfFilterEnabled` bool, and apply it with `host.applyJsonFilter(filter, "general",
  "selfFilter", FilterAction.merge)`. A map can ask for every row inside the area in view once zoomed in,
  so no zoom level ever reaches the limit. The host does not echo this filter back in `options.jsonFilters`,
  so keep your own state; an identical re-push causes no new query.
- **Switch the fields themselves with the same self filter.** Bind a field parameter (for instance a coarse
  and an exact coordinate) and filter its options from the visual: coarse zoomed out, exact zoomed in. Store
  the starting option with the report, because the first query runs before the visual can switch anything.
- **`fetchMoreData` with a `window` reduction** loads the rest in segments of 30,000 when the visual needs
  more than the first window. Sort the query by the size measure so the first window holds the busiest rows.
- **Draw thousands of shapes on a canvas renderer**, not SVG, and swap a shape too small to see for a dot
  sized like a bubble.
- **Anything static and large belongs in storage, not in the model**: files per key or per map tile behind a
  read-only token, fetched by the visual and cached. It never slows the report's query. A catalog file that
  lists what exists lets the format pane offer each layer without a new release of the visual.
- **Auto zoom past outliers.** Fit the view to where most of the weight is (for example 98%, trimmed per
  axis), not to every point: one bad coordinate otherwise zooms the map out to the whole world.
- Verify big-data changes in Desktop on the real model. A DAX query in a tool does not reproduce the visual's
  own query plan.

## Step 12 — A visual repo that stays healthy

A visual is not finished when it renders; it has to live somewhere others can find and rebuild it.

- **Build in CI on every push**: `npm ci`, the tests and `pbiviz package`. With the render harness in the
  package script, a broken render cannot ship.
- **Versions must match and commits must say what changed.** `pbiviz.json` and `package.json` carry the same
  version, and a commit that changes the visual starts with `vX.Y.Z:`. A pre-commit hook can enforce both.
- **The README is documentation, not notes**: a Fields section and a Format pane section, written for the
  report author who has to use the visual.
- Bump the version for every build you install anywhere. Two builds with one version is how you end up
  debugging a visual you did not build.

## Files to copy

- `reference/render-harness.js` — jsdom harness with a complete fake host.
- `reference/on-object.ts` — the parts map, the three sub-selection APIs, every place they attach, with the
  four traps marked.
- `scripts/install-into-report.js` — installs the newest `.pbiviz` into a PBIR report folder, refusing while
  Desktop is open.
- `scripts/Confirm-OpenPrompt.ps1` — confirms Desktop's multiple-data-sources prompt for unattended runs.

## Checklist before calling it done

- [ ] capabilities: roles with conditions, a mapping with a reduction algorithm, the behaviour flags, web
      access if you load anything, every formatting property declared
- [ ] rendering events wired, and a landing page that names the roles to fill
- [ ] pane: cards named the way an author would say them, sections per subject, the on/off switch in the
      header of the card or section it really governs, `onPreProcess` hiding what a different choice makes
      meaningless, per-field settings behind an "Apply settings to" list
- [ ] derived numbers computed over the whole set, display filtered afterwards
- [ ] colours from the palette when not persisted, one opt-out switch, high contrast handled
- [ ] selection painted optimistically, highlights honoured, context menu, tooltips
- [ ] on-object: unique names, `Visual-…-card`, marked at the end of render, handlers stepping aside, no
      rebuild on a sub-selection update
- [ ] layout: one `1fr` with a floor, `fit-content` where a column should follow its content
- [ ] a render scenario per feature, wired into `npm run package`
- [ ] on big data: one query, no measure or Import column in it, detail loaded on demand
- [ ] installed with Desktop closed, screenshotted through the bridge, colours measured against a native visual
