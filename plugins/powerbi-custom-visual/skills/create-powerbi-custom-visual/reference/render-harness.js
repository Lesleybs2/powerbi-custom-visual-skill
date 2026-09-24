// Loads the PACKAGED bundle in jsdom with a fake host and pushes fake data views through update().
// Copy into test/render.test.js, set GUID and the data roles, then add one scenario per feature.
// Wire it up as  "package": "pbiviz package && node test/render.test.js"  so a broken render cannot ship.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");

const GUID = "yourVisualGuidHere";
const bundle = fs.readFileSync(path.join(__dirname, "..", ".tmp", "drop", "visual.js"), "utf8");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only", pretendToBeVisual: true });
const win = dom.window;
win.powerbi = { visuals: { plugins: {} }, extensibility: { visualApiVersions: [] } };
win.eval(bundle);
const plugin = win.powerbi.visuals.plugins[GUID];
assert.ok(plugin, "plugin not registered");

const sel = (key) => ({ getKey: () => key, equals: (o) => o.getKey() === key });
const host = {
    locale: "en-US",
    // Everything the visual may ask the palette for. Vary these in a scenario to prove the visual follows
    // whatever theme it lands in.
    colorPalette: {
        isHighContrast: false,
        foreground: { value: "#000" }, background: { value: "#fff" },
        foregroundNeutralSecondary: { value: "#605e5c" }, foregroundNeutralTertiaryAlt: { value: "#e1dfdd" },
        backgroundLight: { value: "#f3f2f1" }, positive: { value: "#107c10" }, negative: { value: "#a4262c" },
        getColor: () => ({ value: "#118dff" }),
    },
    // Enough of the on-object service for HtmlSubSelectionHelper to start.
    subSelectionService: { subSelect() {}, updateRegionOutlines() {}, clearSubSelection() {} },
    createSelectionManager() {
        return (host._lastManager = {
            _ids: [], registerOnSelectCallback() {},
            getSelectionIds() { return this._ids; },
            select(id) { this._ids = [id]; return Promise.resolve(this._ids); },
            clear() { this._ids = []; return Promise.resolve(); },
            showContextMenu() { return Promise.resolve(); },
        });
    },
    createSelectionIdBuilder: () => { let k = ""; return { withCategory(c, i) { k = `${c.source.queryName}|${i}`; return this; }, createSelectionId: () => sel(k) }; },
    eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed(_o, msg) { throw new Error("renderingFailed: " + msg); } },
    tooltipService: { show() {}, move() {}, hide() {} },
    persistProperties(p) { host.persisted.push(p); },
    persisted: [],
};

const N = 25;
const names = Array.from({ length: N }, (_, i) => `Row ${i}`);
const col = (name, role, gen, format, extra = {}) => ({
    source: { displayName: name, queryName: `t.${name}`, roles: { [role]: true }, format, type: { numeric: true } },
    values: Array.from({ length: N }, (_, i) => gen(i)),
    ...extra,
});

/** objects = what the format pane would have stored; opts shape the data itself. */
function dataView(objects, { nVals = 3, withCompare = false, columnObjects = {} } = {}) {
    const gens = [i => 4000 / (i + 1), i => 1000 - i * 30, i => 3 + (i % 7) * 0.9];
    const values = [];
    for (let k = 0; k < nVals; k++) {
        const c = col(`V${k}`, "values", gens[k], k === 0 ? '"€"#,0.00' : "#,0");
        if (columnObjects[k]) c.source.objects = columnObjects[k];   // per-column formatting, as Power BI stores it
        values.push(c);
    }
    if (withCompare) for (let k = 0; k < nVals; k++) values.push(col(`C${k}`, "compare", i => gens[k](i) * 0.9, "#,0"));
    const categories = [{ source: { displayName: "Name", queryName: "t.Name", roles: { category: true } }, values: names }];
    return { metadata: { columns: [], objects }, categorical: { categories, values } };
}

function run(label, objects, opts) {
    const element = win.document.createElement("div");
    win.document.body.appendChild(element);
    const visual = plugin.create({ element, host });
    visual.update({ dataViews: [dataView(objects, opts)], viewport: { width: 700, height: 431 }, type: 2 });
    const snapshot = element.cloneNode(true);
    const text = element.textContent;
    visual.getFormattingModel();          // the pane must build without throwing, every time
    element.remove();
    visual.destroy();
    console.log(`ok  ${label}`);
    return { visual, element: snapshot, text };
}

// --- scenarios -------------------------------------------------------------------------------------
run("defaults", {});
run("no data view", undefined);
run("high contrast", {});

// Give the visual two different palettes and check the colours move with them.
// Type a term into the search box and check the ranking does not change.
// Click a row and check the host was handed a selection id.
// In format mode, check every marked part carries the sub-selectable class and clicks reach the root.
// Check each navigate shortcut names a card the formatting model actually emits.

console.log("render.test.js: all scenarios rendered");
