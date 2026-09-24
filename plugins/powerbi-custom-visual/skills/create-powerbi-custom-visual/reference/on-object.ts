// On-object formatting: click a part of the visual in format mode and the pane opens on its card.
// Copy into src/visual.ts and rename the parts to yours. Four things must line up or it silently does
// nothing — see SKILL.md step 8.
//
// capabilities.json needs:  "supportsOnObjectFormatting": true,  "enablePointerEventsFormatMode": true

import {
    HtmlSubSelectionHelper, HtmlSubSelectableClass,
    SubSelectableObjectNameAttribute, SubSelectableDisplayNameAttribute, SubSelectableTypeAttribute,
} from "powerbi-visuals-utils-onobjectutils";

import SubSelectionStylesType = powerbi.visuals.SubSelectionStylesType;
import VisualShortcutType = powerbi.visuals.VisualShortcutType;
import CustomVisualSubSelection = powerbi.visuals.CustomVisualSubSelection;

/**
 * Every clickable part: which card (and section) it belongs to, what the toolbar calls it, and the colour
 * the toolbar edits. Names carry a prefix of your own choosing because `title` is Power BI's OWN container object:
 * reuse that name and the host opens its Title card instead of yours. Any unique prefix will do.
 */
const PARTS: Record<string, { card: string; group?: string; label: string; colour?: { objectName: string; propertyName: string }; fill?: boolean }> = {
    visTitle: { card: "title", group: "titleMain", label: "Title", colour: { objectName: "title", propertyName: "color" } },
    visLabel: { card: "text", group: "textRows", label: "Row name", colour: { objectName: "text", propertyName: "labelColor" } },
    visValue: { card: "text", group: "textValues", label: "Value", colour: { objectName: "text", propertyName: "valueColor" } },
    visBars: { card: "bars", group: "barsWhat", label: "Bar", colour: { objectName: "bars", propertyName: "color" }, fill: true },
};

/** Marks an element as clickable in format mode. Call this at the END of render, after the rows exist. */
function subSelectable(e: HTMLElement, part: string): void {
    const p = PARTS[part];
    if (!p) return;
    e.setAttribute(SubSelectableObjectNameAttribute, part);
    e.setAttribute(SubSelectableDisplayNameAttribute, p.label);
    // Declare the same type as the styles you return below, or the host drops the whole answer.
    e.setAttribute(SubSelectableTypeAttribute, String(SubSelectionStylesType.Shape));
}

// --- in the constructor ----------------------------------------------------------------------------
// Older hosts do not offer the service; the visual must still run there, just without on-object.
if (options.host.subSelectionService) {
    this.subSelectionHelper = HtmlSubSelectionHelper.createHtmlSubselectionHelper({
        hostElement: root,
        subSelectionService: options.host.subSelectionService,
        selectionIdCallback: () => this.host.createSelectionIdBuilder().createSelectionId(),
    });
}

// --- in update() -----------------------------------------------------------------------------------
// Power BI calls update again the moment a part is sub-selected. Rebuilding the rows then throws away the
// element the host is holding, and the pane never opens. Refresh the outlines only.
const subSelectionOnly = (options.type & powerbi.VisualUpdateType.FormattingSubSelectionChange) !== 0
    && (options.type & ~(powerbi.VisualUpdateType.FormattingSubSelectionChange | powerbi.VisualUpdateType.FormatModeChange)) === 0;
if (subSelectionOnly) {
    this.formatMode = !!options.formatMode;
    this.subSelectionHelper?.setFormatMode(this.formatMode);
    this.subSelectionHelper?.updateOutlinesFromSubSelections(options.subSelections ?? [], true);
    return;
}
// ... normal path:
this.formatMode = !!options.formatMode;
this.subSelectionHelper?.setFormatMode(this.formatMode);
this.render();
if (this.formatMode) this.subSelectionHelper?.updateOutlinesFromSubSelections(options.subSelections ?? [], true);

// --- at the END of render() ------------------------------------------------------------------------
// Only while formatting are the parts clickable; in view mode a click belongs to the data.
this.rootEl.querySelectorAll(`[${SubSelectableObjectNameAttribute}]`)
    .forEach(e => e.classList.toggle(HtmlSubSelectableClass, this.formatMode));

// --- every click handler of your own -----------------------------------------------------------------
// The helper listens on the root element and depends on bubbling. A stopPropagation here is exactly why
// "only the title works": the title is the one element without a handler.
cell.addEventListener("click", e => {
    if (this.formatMode) return;
    e.stopPropagation();
    /* select, sort, page … */
});

// --- the three APIs --------------------------------------------------------------------------------
public visualOnObjectFormatting: powerbi.extensibility.visual.VisualOnObjectFormatting = {
    getSubSelectionStyles: (subSelections: CustomVisualSubSelection[]) => {
        const p = PARTS[subSelections[0]?.customVisualObjects[0]?.objectName];
        if (!p?.colour) return undefined;
        const style = { reference: { ...p.colour }, label: p.label };
        return p.fill
            ? { type: SubSelectionStylesType.Shape, fill: style }
            : { type: SubSelectionStylesType.Shape, color: style };
    },
    getSubSelectionShortcuts: (subSelections: CustomVisualSubSelection[]) => {
        const p = PARTS[subSelections[0]?.customVisualObjects[0]?.objectName];
        if (!p) return undefined;
        return [
            ...(p.colour ? [{ type: VisualShortcutType.Reset, relatedResetFormattingIds: [{ ...p.colour }] } as never] : []),
            // The prefix is required. Without it the host cannot find the card and opens its own.
            // The group uid carries NO prefix. A navigate shortcut must always be last.
            {
                type: VisualShortcutType.Navigate,
                destinationInfo: { cardUid: `Visual-${p.card}-card`, ...(p.group ? { groupUid: `${p.group}-group` } : {}) },
                label: `Format ${p.label.toLowerCase()}`,
            } as never,
        ];
    },
    getSubSelectables: () => this.subSelectionHelper?.getAllSubSelectables(),
};
