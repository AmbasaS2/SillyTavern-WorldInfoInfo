import { chat, chat_metadata, event_types, eventSource, main_api, extension_prompts, saveSettingsDebounced, getCurrentChatId } from '../../../../script.js';
import { translate as stTranslate, getCurrentLocale } from '../../../i18n.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import * as insightOpenAI from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { delay, flashHighlight } from '../../../utils.js';
import { world_info_position, world_names, loadWorldInfo, openWorldInfoEditor } from '../../../world-info.js';
import { getRegexedString, regex_placement } from '../../regex/engine.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { isAdmin, getCurrentUserHandle } from '../../../user.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { showdown, DOMPurify } from '../../../../lib.js';
import { tryOpenInLoreLibrary } from './lore-library-link.js';
import { createJevRecallReceipts } from './jev-recall-display.js';
import { readManagerTranslationBook, managerTranslatedTitle, managerTranslatedBody } from './lore-manager-translations.js';
import { canReplaceReport, persistReport } from './report-storage.js';
import { createLoreInsight, createInsightTokenCache, insightReason, insightReasonCodes, canShowInsightWorld, requestTextParts, hasCompleteEvidence, verifiedInsightRows } from './lore-insight.mjs';
import { observePromptAssembly } from './prompt-inclusion.mjs';


// Localize only extension-authored UI. Lorebook text and stored translations are untouched.
const WI_UI_EN = {
    "trigger.tooltip": "Injected lore entries\nTap: show list · Long press / right click: settings",
    "settings.group.label": "Group by lorebook",
    "settings.group.hint": "Group injected entries by their lorebook.",
    "settings.order.label": "Show in injection order",
    "settings.order.hint": "Sort by insertion position and order rather than by title.",
    "settings.messages.label": "Show chat message positions",
    "settings.messages.hint": "Show the chat messages between injected lore entries when grouping is off and injection order is on.",
    "settings.tokens.label": "Show injected lore token total",
    "settings.tokens.hint": "Optional estimate when you open the list. No token counting during generation.",
    "settings.original.label": "View original text",
    "settings.original.hint": "Show original lore titles and text in WorldInfo Info instead of saved translations. Does not change the Lorebook Library.",
    "settings.library.label": "Link Lorebook Library",
    "settings.library.hint": "When available, open the clicked injected lore in the independent Lorebook Library. Otherwise use the existing reader.",
    "panel.tokens.label": "Injected lore total",
    "panel.tokens.value": "~{0} tokens",
    "panel.tokens.calculating": "Counting…",
    "panel.tokens.waiting": "Available after generation",
    "panel.tokens.ready": "Open list to calculate",
    "panel.tokens.unavailable": "Token count unavailable",
    "settings.drag.label": "Allow dragging the book button",
    "settings.drag.hint": "Allow the book button to be moved to another location.",
    "settings.reset.label": "Reset book button position",
    "settings.reset.hint": "Move the book button back to its default position.",
    "panel.none": "No injected lore entries",
    "panel.waiting": "Checking the prompt…",
    "panel.hidden": "(hidden entries)",
    "panel.ungrouped": "Lore entries",
    "entry.note": "Author’s Note",
    "entry.sticky": "Sticky for {0} more rounds",
    "entry.message.one": "Message #{0}",
    "entry.message.range": "Messages #{0}–{1}",
    "entry.message.count": "{0} msgs",
    "reader.dialog": "Lore entry",
    "reader.close": "Close",
    "reader.body": "Lore text (read-only)",
    "reader.loading": "Loading lore…",
    "reader.mode.label": "Configured",
    "reader.mode.constant": "Always active",
    "reader.mode.normal": "Keyword",
    "reader.mode.vectorized": "Vectorized",
    "reader.reason.label": "Activated by",
    "reader.reason.unknown": "Reason not recorded",
    "reader.reason.keyword": "Keyword match",
    "reader.reason.vector": "Vector search",
    "reader.reason.constant": "Always active",
    "reader.reason.jev": "Jev memory recall",
    "reader.reason.sticky": "Sticky continuation",
    "reader.reason.external": "External activation",
    "reader.reason.decorator": "@@activate directive",
    "reader.reason.secondary": "Secondary condition",
    "reader.route.outlet": "Via outlet",
    "command.triggered.returns": "last displayed lore entries as JSON",
    "command.triggered.help": "Return the lore entries shown for the last visible generation. Usage: /wi-triggered",
    "command.reset.returns": "resets the book button position",
    "command.reset.help": "Reset the book button to its default position. Usage: /wi-position-reset",
    "command.reset.done": "Book button position reset.",
    "command.report.returns": "opens a lore keyword report",
    "command.report.help": "Show which keywords activated lore entries, including recursion loops. Usage: /wi-report",
    "command.report.done": "Lore keyword report opened.",
    "report.title": "Lore keyword report",
    "report.summary": "Injected lore entries: {0} · Keyword types: {1}",
    "report.empty": "No activation records available for the last generation.",
    "report.truncated": "This saved report was shortened to fit the storage limit. Generate a reply for a full current report.",
    "report.incomplete": "Activation capture was incomplete. The previous saved report was retained.",
    "report.loopSummary": "Loop {0}: {1} entries",
    "report.loopTitle": "Loop {0}",
    "report.frequency": "Keyword frequency",
    "report.keyword": "Keyword",
    "report.hits": "Occurrences",
    "report.entries": "Entries",
    "report.entryCount": "{0} entries",
    "report.noKeyword": "(no recorded keyword)",
    "report.forceActivated": "(force activated)",
    "settings.insight.label": "View Lore Insight",
    "settings.insight.hint": "Inspect the latest RP lore and token estimates.",
    "insight.title": "Lore Insight",
    "insight.waiting": "Checking the actual request…",
    "insight.empty": "No captured RP data in this chat. Generate a reply first.",
    "insight.note": "Only verified lorebook insertions are counted in the book list and token estimates. Only entries whose omission is confirmed are listed as not inserted. Tap an underlined term to see its meaning. Token counts are estimates; combined and individual totals may differ.",
    "insight.activated": "Activated (visible)",
    "insight.matched": "Verified injected lore",
    "insight.unresolved": "Insertion unverified",
    "insight.total": "Verified lore token estimate",
    "insight.share": "Verified lore share of input",
    "insight.unmeasured": "Not measured",
    "insight.unmatched": "Original text not found",
    "insight.unknown": "Insufficient evidence",
    "insight.ambiguous": "Repeated or overlapping text",
    "insight.measure": "Calculate token estimates",
    "insight.counting": "Estimating tokens…",
    "insight.measured": "Token estimates calculated",
    "insight.books": "By lorebook",
    "insight.reasons": "By activation reason",
    "insight.entries": "Injected lore",
    "insight.visible": "Hidden lore excluded. Full-prompt ratio is not calculated.",
    "insight.limit": "Capture or detail limit reached. Values may be partial; unmeasured values are not zero.",
    "insight.multiple": "Multiple recorded reasons",
    "insight.source.assembled": "Evidence: assembled prompt",
    "insight.source.request": "Evidence: pre-send request messages",
    "insight.scopeChanged": "Tokenizer or generation context changed. Generate a new reply to measure.",
    "insight.help": "About these estimates",
    "insight.count": "{0} entries",
    "insight.noMatches": "No verified injected lore.",
    "insight.retry": "Retry missing estimates",
    "insight.jev.source.all": "Jev full assessment",
    "insight.jev.source.native": "Native search candidate",
    "insight.jev.source.adaptive-durable": "Durable-memory cue",
    "insight.jev.source.adaptive-concise": "Short-memory cue",
    "insight.jev.source.adaptive-role": "Memory-role cue",
    "insight.jev.source.adaptive-anchors": "Title/key cues",
    "insight.jev.source.adaptive-recent": "Recent source cue",
    "insight.jev.score": "Selection score {0}",
    "insight.evidence.summary": "Omitted: {0} · Unverified: {1}",
    "insight.evidence.verified": "Insertion confirmed",
    "insight.evidence.textOnly": "Matching text only",
    "panel.noneVerified": "No verified injected lore",
    "insight.excluded": "Activated but not inserted",
    "insight.excluded.preset": "Disabled preset section",
    "insight.excluded.context": "Omitted during assembly",
    "insight.explain.evidence.verified": "This entry was traced to the actual pre-send request.",
    "insight.explain.evidence.textOnly": "The same text appears in the request, but its insertion source is unverified.",
    "insight.explain.unmatched": "The captured original text was not found in the request.",
    "insight.explain.unknown": "The available request evidence is insufficient to determine insertion.",
    "insight.explain.ambiguous": "Repeated or overlapping text prevents unique attribution.",
    "insight.explain.excluded.preset": "The preset's insertion section for this entry is disabled.",
    "insight.explain.excluded.context": "The observed insertion slot was omitted from the final prompt assembly.",
    "insight.explain.reason.constant": "The engine activated this entry through its always-active setting.",
    "insight.explain.reason.keyword": "A configured keyword matched the scan text.",
    "insight.explain.reason.vector": "The vector search returned this entry as a match.",
    "insight.explain.reason.jev": "Jev selected this memory for the current generation.",
    "insight.explain.reason.sticky": "A previously activated entry remains active for the configured rounds.",
    "insight.explain.reason.decorator": "The @@activate directive triggered this entry.",
    "insight.explain.reason.external": "An external extension or host event activated this entry.",
    "insight.explain.reason.unknown": "The engine did not record a specific activation reason.",
    "insight.explain.reason.multiple": "More than one activation reason was observed.",
    "insight.explain.outlet": "This lore uses an outlet macro as its insertion route.",
    "insight.explain.jev.source.all": "Jev assessed all eligible memories instead of narrowing them through search.",
    "insight.explain.jev.source.native": "The host's existing search included this memory among Jev's candidates.",
    "insight.explain.jev.source.adaptive-durable": "A recorded long-term memory cue included this candidate.",
    "insight.explain.jev.source.adaptive-concise": "The short-memory rule included this candidate for assessment.",
    "insight.explain.jev.source.adaptive-role": "The memory's recorded role metadata included this candidate.",
    "insight.explain.jev.source.adaptive-anchors": "Title or keyword cues from the recent conversation included this candidate.",
    "insight.explain.jev.source.adaptive-recent": "A recorded recent conversation source included this candidate.",
    "insight.explain.jev.score": "The inclusion score returned by Jev for this memory.",
    "insight.explain.jev.accepted": "The memory was selected within the configured lore token limit.",
    "insight.jev.accepted": "Budget accepted"
};
function wiT(key, ...values) {
    const source = WI_UI_EN[key] ?? key;
    const translated = stTranslate(source, 'worldInfoInfo.' + key) || source;
    return String(translated).replace(/\{(\d+)\}/g, (match, index) =>
        values[Number(index)] === undefined ? match : String(values[Number(index)]));
}

function slothToastTitle() {
    const locale = String(getCurrentLocale() || '').toLowerCase();
    return '🦥 ' + (/^ko(?:[-_]|$)/.test(locale) ? '월드인포인포' : 'WorldInfo Info');
}

const STWII = (window.STWII ||= {});
let navigatingEntry = false;

async function openActiveEntry(world, uid) {
    if (navigatingEntry) return;
    navigatingEntry = true;
    try {
        const entryUid = Number(uid);
        if (!world_names.includes(world)) throw new Error('Lorebook no longer exists');
        const data = await loadWorldInfo(world);
        if (!data?.entries?.[entryUid]) throw new Error('Entry no longer exists');
        openWorldInfoEditor(world);
        const expected = String(world_names.indexOf(world));
        const select = document.querySelector('#world_editor_select');
        const pagination = $('#world_info_pagination');
        const list = document.querySelector('#world_popup_entries_list');
        const waitFor = async (predicate) => {
            for (let i = 0; i < 100; i++) {
                if (select?.value !== expected) throw new Error('Lorebook selection changed');
                if (predicate()) return;
                await delay(50);
            }
            throw new Error('World Info editor did not finish loading');
        };
        await waitFor(() => pagination.data('pagination')?.initialized &&
            list?.querySelectorAll('.world_entry').length === pagination.pagination('getCurrentPageData')?.length);
        const total = pagination.pagination('getTotalPage');
        for (let page = 1; page <= total; page++) {
            const entries = pagination.pagination('getCurrentPageData');
            if (entries.some(entry => Number(entry.uid) === entryUid)) {
                await waitFor(() => !!list?.querySelector(`.world_entry[uid="${entryUid}"]`));
                const target = list.querySelector(`.world_entry[uid="${entryUid}"]`);
                const control = target.querySelector('.inline-drawer-icon');
                if (!control) throw new Error('Entry control unavailable');
                if (!target.querySelector('.inline-drawer-outlet')?.offsetParent) control.click();
                const content = target.querySelector('textarea[name="content"]');
                if (!content) throw new Error('Entry content field unavailable');
                target.scrollIntoView({ block: 'center' });
                content.focus();
                flashHighlight($(target));
                return;
            }
            if (page < total) {
                const next = pagination.pagination('getCurrentPageNum') + 1;
                pagination.pagination('go', next);
                await waitFor(() => pagination.pagination('getCurrentPageNum') === next &&
                    list?.querySelectorAll('.world_entry').length === pagination.pagination('getCurrentPageData').length);
            }
        }
        throw new Error('Entry is unavailable in the editor');
    } catch (error) {
        toastr.warning(error.message, slothToastTitle());
    } finally {
        navigatingEntry = false;
    }
}
STWII.MAX_BUILD_LOGS = STWII.MAX_BUILD_LOGS ?? 2000;

function resetWiTriggerPosition(triggerEl = window.STWII?.trigger) {
    if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
    delete extension_settings.worldInfoInfo.triggerPos;
    // Clear inline overrides -> back to CSS default (bottom-left)
    if (triggerEl) {
        triggerEl.style.left = '';
        triggerEl.style.top = '';
        triggerEl.style.right = '';
        triggerEl.style.bottom = '';
    }
    saveSettingsDebounced();
    requestAnimationFrame(() => STWII.repairPositions?.());
}
STWII.resetWiTriggerPosition = resetWiTriggerPosition;

function pushBounded(arr, item, max) {
    try {
        arr.push(item);
        if (arr.length > max) arr.splice(0, arr.length - max);
    } catch {}
}

const strategy = {
    constant: '🔵',
    normal: '🟢',
    vectorized: '🔗',
    jev: '🔮',
};
const getStrategy = (entry)=>{
    if (entry.stwiiJevRecall === true) return 'jev';
    if (entry.constant === true) {
        return 'constant';
    } else if (entry.vectorized === true) {
        return 'vectorized';
    } else {
        return 'normal';
    }
};


// Preserve the legacy in-memory translations for older Lorebook Manager
// versions. Newer versions use per-book files, read on viewer open only.
function showOriginalLore() {
    return extension_settings.worldInfoInfo?.showOriginalLore === true;
}

function displayWiTitle(entry, snapshot = null) {
    const source = String(entry?.comment ?? '');
    const original = source.trim()
        || (Array.isArray(entry?.key) ? entry.key : entry?.keys ?? []).join(', ');
    if (showOriginalLore()) return original;
    return managerTranslatedTitle(entry, snapshot, extension_settings['simple-lorebook']) || original;
}

function displayWiBody(entry, snapshot = null) {
    const source = String(entry?.content ?? '');
    if (showOriginalLore()) return source;
    return managerTranslatedBody(entry, snapshot, extension_settings['simple-lorebook']) ?? source;
}

// Cherry&Solti RT stores read-only translation results in one file per lorebook.
// No writes to RT or world info, no persistent DOM observer and no polling.
const rtBookCache = new Map();
const RT_BOOK_CACHE_LIMIT = 8;
function rtSourceHash(text) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const fnv1a = (str, seed) => {
        let hash = seed >>> 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
            hash = Math.imul(hash ^ ((code >>> 8) & 0xff), 0x01000193) >>> 0;
        }
        return hash >>> 0;
    };
    const partA = fnv1a(value, 0x811c9dc5);
    const partB = fnv1a(value + '\u0001cslt', 0x9e3779b1);
    return partA.toString(16).padStart(8, '0') + partB.toString(16).padStart(8, '0');
}
async function rtTranslationsForWorld(world) {
    const rtSettings = extension_settings['lorebook-translator'];
    if (!rtSettings || !world) return null;
    const index = rtSettings.fileIndex?.[world];
    // RT may switch to legacy settings storage if file writes fail.
    if (rtSettings.storageMode === 'legacy') {
        return rtSettings.cache && typeof rtSettings.cache === 'object' ? rtSettings.cache : null;
    }

    if (index?.file) {
        // Accept only Cherry&Solti's generated hash filenames.
        const filename = String(index.file);
        if (!/^cslt_[0-9a-f]{16}\.json$/i.test(filename)) return null;
        const version = filename + ':' + String(index.updatedAt ?? '');
        const cached = rtBookCache.get(world);
        if (cached?.version === version) return cached.records;
        try {
            const headers = getContext?.()?.getRequestHeaders?.();
            const response = await fetch('/user/files/' + filename, {
                method: 'GET',
                credentials: 'same-origin',
                ...(headers ? { headers } : {}),
                cache: 'no-store',
            });
            if (!response.ok) return null;
            const document = await response.json();
            if (document?.world !== world || !document.cache || typeof document.cache !== 'object') return null;
            const records = document.cache;
            // Cache only per lorebook, on demand. RT updates fileIndex.updatedAt when it saves.
            rtBookCache.delete(world);
            rtBookCache.set(world, { version, records });
            while (rtBookCache.size > RT_BOOK_CACHE_LIMIT) {
                rtBookCache.delete(rtBookCache.keys().next().value);
            }
            return records;
        } catch {
            // If RT's file is not readable, show the original rather than stale legacy data.
            return null;
        }
    }

    // Older RT versions store the data directly in extension settings.
    return rtSettings.cache && typeof rtSettings.cache === 'object' ? rtSettings.cache : null;
}
async function rtTranslatedBody(entry) {
    const world = String(entry?.world ?? '');
    const uid = String(entry?.uid ?? '');
    const records = await rtTranslationsForWorld(world);
    const record = records?.[world + '::' + uid];
    if (typeof record?.content !== 'string' || !record.content.trim() || record.truncated === true) return null;

    // RT saves src.c for the source body. Refuse stale translations after edits.
    const source = String(entry?.content ?? '');
    if (!source.trim() || !record.src?.c || rtSourceHash(source) !== record.src.c) return null;
    return record.content;
}


// Use SillyTavern's bundled markdown renderer for read-only lore previews.
// Render only when the viewer's content changes; never re-render the chat or book list.
const wiLoreMarkdown = new showdown.Converter({
    emoji: true,
    literalMidWordUnderscores: true,
    parseImgDimensions: true,
    tables: true,
    simpleLineBreaks: true,
    strikethrough: true,
    underline: true,
});
// Presentation-only normalization of decorative lore headings. Source and
// translated records are never rewritten; fenced code blocks are preserved.
function formatLoreReaderMarkdown(source) {
    const lines = String(source ?? '').split(/\r?\n/);
    let fenceChar = '', fenceLength = 0;
    for (let i = 0; i < lines.length; i++) {
        const fence = lines[i].match(/^ {0,3}(\x60{3,}|~{3,})/);
        if (fence) {
            if (!fenceChar) {
                fenceChar = fence[1][0];
                fenceLength = fence[1].length;
            } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
                fenceChar = '';
                fenceLength = 0;
            }
            continue;
        }
        if (fenceChar) continue;
        const decorated = lines[i].match(/^ {0,3}={3,}[ \t]*(.+?)[ \t]*={3,}[ \t]*$/);
        if (decorated && decorated[1].trim()) {
            lines[i] = '### ' + decorated[1].trim();
            continue;
        }
        const bracketed = lines[i].match(/^ {0,3}\[([^\[\]\n]{3,100})\][ \t]*$/);
        if (bracketed && bracketed[1].trim()) {
            lines[i] = '#### ' + bracketed[1].trim();
        }
    }
    return lines.join('\n');
}
function renderLorePreview(target, source) {
    const content = String(source ?? '');
    try {
        target.innerHTML = DOMPurify.sanitize(wiLoreMarkdown.makeHtml(formatLoreReaderMarkdown(content)), {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'select', 'button', 'textarea'],
            FORBID_ATTR: ['style'],
        });
    } catch (error) {
        // Even if the renderer is unavailable, keep a readable, safe fallback.
        target.textContent = content;
    }
}


// Match the *computed* typography of a real character message. Copying font
// styles to the dialog parent did not override .mes_text on the preview itself,
// and selectors scoped to #chat do not match a modal mounted under <html>.
// Do this only when opening the viewer; no polling or global observers.
function matchLoreReaderChatTypography(dialog, body) {
    const source = document.querySelector('#chat .mes.last_mes[is_user="false"]:not(.smallSysMes) .mes_text:not(:empty)')
        || document.querySelector('#chat .mes[is_user="false"]:not(.smallSysMes) .mes_text:not(:empty)')
        || document.querySelector('#chat .mes:not(.smallSysMes) .mes_text:not(:empty)');
    if (!source) return;
    // Gather comparisons before writing styles, avoiding interleaved
    // style recalculation/layout. Runs once per reader open, never in scans.
    const sourceStyle = getComputedStyle(source);
    const currentBodyStyle = getComputedStyle(body);
    const currentDialogStyle = getComputedStyle(dialog);
    const typography = [
        'font-family', 'font-size', 'font-weight', 'font-style',
        'font-stretch', 'font-variation-settings',
        'font-feature-settings', 'font-kerning', 'font-optical-sizing',
        'font-synthesis', 'line-height', 'letter-spacing', 'word-spacing',
        'text-shadow', 'text-rendering', '-webkit-font-smoothing',
    ];
    const bodyChanges = typography.map(property => ({
        property,
        value: sourceStyle.getPropertyValue(property),
        existing: currentBodyStyle.getPropertyValue(property),
    })).filter(({ value, existing }) => value && value.trim() !== existing.trim());
    // Title uses normal font weight by design; copy only shared font metrics.
    const titleChanges = ['font-family', 'font-size', 'line-height',
        'letter-spacing', 'word-spacing', 'text-shadow'].map(property => ({
        property,
        value: sourceStyle.getPropertyValue(property),
        existing: currentDialogStyle.getPropertyValue(property),
    })).filter(({ value, existing }) => value && value.trim() !== existing.trim());

    for (const { property, value } of bodyChanges) body.style.setProperty(property, value, 'important');
    for (const { property, value } of titleChanges) dialog.style.setProperty(property, value);
}


// Keep verification on the displayed snapshot, not in saved lore data.
const confirmedOutletEntries = new WeakSet();
const confirmedRenderedEntries = new WeakMap();
const displayedActivationEvents = new WeakMap();

// Explain the most recent confirmed activation using the already-captured
// compact /wi-report event. Do not rescan lore, query vectors, or parse logs
// when the reader opens. A missing event is not evidence of vector activation.
function describeLoreActivation(entry) {
    const outletSuffix = confirmedOutletEntries.has(entry) ? ' · ' + wiT('reader.route.outlet') : '';
    // Jev evidence belongs to this displayed entry, not the saved constant flag.
    if (entry?.stwiiJevRecall === true) {
        let selection='';
        try{selection=globalThis.STWII?.loreInsight?.selectionFor(entry)||'';}catch{}
        return '🔮 ' + wiT('reader.reason.jev') + (selection?' · '+selection:'') + outletSuffix;
    }
    const events = chat_metadata.stwiiLastReport?.added;
    const ev = displayedActivationEvents.has(entry) ? displayedActivationEvents.get(entry) :
        (Array.isArray(events) ? events.find(item =>
            item?.world === entry?.world && Number(item.uid) === Number(entry?.uid)) : null);
    const causes = [];
    if (ev) {
        const logic = String(ev.logic || '');
        const primary = typeof ev.primary === 'string' ? ev.primary.trim() : '';
        const secondary = Array.isArray(ev.secondary) ? ev.secondary.filter(x => typeof x === 'string' && x.trim()) : [];
        const hasKeywordEvidence = primary || ['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL'].includes(logic);
        if (hasKeywordEvidence) {
            let cause = strategy.normal + ' ' + wiT('reader.reason.keyword');
            if (primary) cause += ' · ' + primary;
            if (secondary.length) cause += ' · ' + wiT('reader.reason.secondary') + ' · ' + secondary.join(', ');
            else if (logic === 'NOT_ANY' || logic === 'NOT_ALL') cause += ' · ' + logic.replace('_', ' ');
            causes.push(cause);
        }
        if (ev.vectorConfirmed === true) causes.push(strategy.vectorized + ' ' + wiT('reader.reason.vector'));
        if (logic === 'CONSTANT') causes.push(strategy.constant + ' ' + wiT('reader.reason.constant'));
        if (logic === 'STICKY') causes.push('📌 ' + wiT('reader.reason.sticky'));
        if (logic === 'DECORATOR') causes.push('🪄 ' + wiT('reader.reason.decorator'));
        if ((logic === 'FORCE_ACTIVATE' || logic === 'EXTERNAL') && ev.vectorConfirmed !== true) {
            causes.push('⚡ ' + wiT('reader.reason.external'));
        }
    }
    return (causes.length ? causes.join(' + ') : '❔ ' + wiT('reader.reason.unknown')) + outletSuffix;
}

// Evaluate the option and the bridge only on an actual entry click.
// No manager installed, option off, or navigation failure => original viewer.
let linkedLoreClickSerial = 0;
async function showInjectedLore(entry) {
    const serial = ++linkedLoreClickSerial;
    const enabled = extension_settings.worldInfoInfo?.linkLoreLibrary === true;
    const bridge = window.__slbLoreLibraryBridge;
    if (!enabled || bridge?.apiVersion !== 1 || typeof bridge.openEntry !== 'function') {
        void showLoreViewer(entry);
        return;
    }
    const opened = await tryOpenInLoreLibrary(entry, true, bridge);
    if (serial !== linkedLoreClickSerial) return;
    if (opened) closeLoreViewer();
    else void showLoreViewer(entry);
}

let currentLoreViewer=null;
function closeLoreViewer() {
    const viewer=currentLoreViewer;
    if (!viewer) return;
    currentLoreViewer=null;
    document.removeEventListener('keydown',viewer.onKeydown);
    window.removeEventListener('resize',viewer.reposition);
    window.removeEventListener('orientationchange',viewer.reposition);
    window.visualViewport?.removeEventListener?.('resize',viewer.reposition);
    window.visualViewport?.removeEventListener?.('scroll',viewer.reposition);
    if (viewer.repositionFrame !== null) cancelAnimationFrame(viewer.repositionFrame);
    viewer.overlay.close();
    viewer.overlay.remove();
    viewer.previousFocus?.focus?.();
}
async function showLoreViewer(entry) {
    closeLoreViewer();
    const overlay=document.createElement('dialog');
    overlay.className='stwii--reader-overlay';
    const dialog=document.createElement('section');
    dialog.className='stwii--reader-dialog';
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    dialog.setAttribute('aria-label',wiT('reader.dialog'));
    const header=document.createElement('div');
    header.className='stwii--reader-header';
    const title=document.createElement('div');
    title.className='stwii--reader-title';
    title.textContent=displayWiTitle(entry);
    const close=document.createElement('button');
    close.type='button';
    close.className='stwii--reader-close';
    close.setAttribute('aria-label',wiT('reader.close'));
    close.textContent='×';
    const activation=document.createElement('div');
    activation.className='stwii--reader-activation';
    // Reserve the final metadata line before the modal is measured/positioned.
    activation.textContent=describeLoreActivation(entry);
    const body=document.createElement('div');
    // Reuse the same Markdown typography and theme rules as chat messages.
    body.className='stwii--reader-body mes_text';
    body.setAttribute('role','document');
    body.setAttribute('aria-label',wiT('reader.body'));
    body.tabIndex=0;
    body.textContent=wiT('reader.loading');
    header.append(title,close);
    dialog.append(header,activation,body);
    overlay.append(dialog);
    const previousFocus=document.activeElement;

    // Keep the body's theme scope (fonts, noShadows, etc.). The native modal
    // top layer keeps fixed positioning independent of transformed ancestors.
    const settingsKey = window.innerWidth <= 600 ? 'readerPosMobile' : 'readerPosDesktop';
    const stored = extension_settings.worldInfoInfo?.[settingsKey];
    const offset = {
        x: Number.isFinite(stored?.x) ? stored.x : 0,
        y: Number.isFinite(stored?.y) ? stored.y : 0,
    };
    const viewer = {
        overlay, previousFocus, onKeydown: null, reposition: null,
        repositionFrame: null,
    };
    function getViewerBounds() {
        const vv = window.visualViewport;
        const left = Number(vv?.offsetLeft) || 0;
        const top = Number(vv?.offsetTop) || 0;
        const width = Math.max(1, Number(vv?.width) || window.innerWidth || 1);
        const height = Math.max(1, Number(vv?.height) || window.innerHeight || 1);
        return { left, top, right: left + width, bottom: top + height, width, height };
    }
    function placeViewer() {
        if (currentLoreViewer !== viewer) return;
        const b = getViewerBounds();
        const margin = 12;
        dialog.style.maxWidth = Math.max(1, b.width - 2 * margin) + 'px';
        dialog.style.maxHeight = Math.max(1, Math.min(b.height - 2 * margin, 900)) + 'px';
        // Keep the reader in the same visual viewport coordinate system as
        // the chat, without compositing its text through a 3D transform.
        // This also preserves the previous saved center-relative offsets.
        dialog.style.position = 'fixed';
        const r = dialog.getBoundingClientRect();
        const centerX = b.left + (b.width - r.width) / 2;
        const centerY = b.top + (b.height - r.height) / 2;
        const minX = b.left + margin;
        const minY = b.top + margin;
        const maxX = Math.max(minX, b.right - margin - r.width);
        const maxY = Math.max(minY, b.bottom - margin - r.height);
        const x = Math.round(Math.max(minX, Math.min(maxX, centerX + offset.x)));
        const y = Math.round(Math.max(minY, Math.min(maxY, centerY + offset.y)));
        // Update offsets after clamping so future pointer movement is stable.
        offset.x = x - centerX;
        offset.y = y - centerY;
        dialog.style.left = x + 'px';
        dialog.style.top = y + 'px';
        dialog.style.right = 'auto';
        dialog.style.bottom = 'auto';
    }
    function schedulePlaceViewer() {
        if (viewer.repositionFrame !== null) return;
        viewer.repositionFrame = requestAnimationFrame(() => {
            viewer.repositionFrame = null;
            placeViewer();
        });
    }
    viewer.reposition = schedulePlaceViewer;

    // Only the modal header can drag it. No global observer or per-frame polling.
    let pointer = null;
    header.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.target.closest('button')) return;
        e.preventDefault();
        pointer = { id: e.pointerId, x: e.clientX, y: e.clientY,
            startX: offset.x, startY: offset.y, moved: false };
        try { header.setPointerCapture(e.pointerId); } catch {}
        dialog.classList.add('stwii--reader-dragging');
    });
    header.addEventListener('pointermove', e => {
        if (!pointer || pointer.id !== e.pointerId) return;
        const dx = e.clientX - pointer.x;
        const dy = e.clientY - pointer.y;
        if (Math.abs(dx) + Math.abs(dy) >= 3) pointer.moved = true;
        offset.x = pointer.startX + dx;
        offset.y = pointer.startY + dy;
        placeViewer();
    });
    function finishViewerDrag(e, save) {
        if (!pointer || pointer.id !== e.pointerId) return;
        const didMove = pointer.moved;
        pointer = null;
        dialog.classList.remove('stwii--reader-dragging');
        try { header.releasePointerCapture(e.pointerId); } catch {}
        if (save && didMove) {
            if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
            extension_settings.worldInfoInfo[settingsKey] = {
                x: Math.round(offset.x), y: Math.round(offset.y),
            };
            saveSettingsDebounced();
        }
    }
    header.addEventListener('pointerup', e => finishViewerDrag(e, true));
    header.addEventListener('pointercancel', e => finishViewerDrag(e, false));

    const onKeydown=(event)=>{
        if (event.key==='Escape') {event.preventDefault();closeLoreViewer();}
        if (event.key==='Tab' && !dialog.contains(document.activeElement)) {
            event.preventDefault();close.focus();
        }
    };
    viewer.onKeydown = onKeydown;
    currentLoreViewer = viewer;
    close.addEventListener('click',closeLoreViewer);
    overlay.addEventListener('click',event=>{if(event.target===overlay)closeLoreViewer();});
    overlay.addEventListener('cancel',event=>{event.preventDefault();closeLoreViewer();});
    document.body.append(overlay);
    overlay.showModal();
    matchLoreReaderChatTypography(dialog, body);
    document.addEventListener('keydown',onKeydown);
    window.addEventListener('resize',schedulePlaceViewer,{ passive: true });
    window.addEventListener('orientationchange',schedulePlaceViewer,{ passive: true });
    window.visualViewport?.addEventListener?.('resize',schedulePlaceViewer,{ passive: true });
    window.visualViewport?.addEventListener?.('scroll',schedulePlaceViewer,{ passive: true });
    placeViewer();
    close.focus();
    try {
        // One on-demand, read-only request for this book's current translation
        // snapshot; start beside the existing WorldInfo read, never at startup,
        // while scanning prompts, or when rendering the injected-entry list.
        const originalOnly = showOriginalLore();
        const hasManager = !originalOnly && Boolean(extension_settings['simple-lorebook'] || window.__slbLoreManagerActive);
        const [data, translationFile] = await Promise.all([
            loadWorldInfo(entry.world),
            hasManager
                ? readManagerTranslationBook(entry.world, (url, options) => fetch(url, options),
                    getContext?.()?.getRequestHeaders?.())
                : Promise.resolve(null),
        ]);
        if (currentLoreViewer?.overlay!==overlay) return;
        const current=data?.entries?.[Number(entry.uid)];
        const full=current ? {...current,world:entry.world,uid:entry.uid} : entry;
        title.textContent=displayWiTitle(full, translationFile);
        schedulePlaceViewer();
        const source=String(full?.content ?? '');
        const managerText=displayWiBody(full, translationFile);
        renderLorePreview(body,managerText);
        // Prefer an existing, current Lorebook Manager translation. RT supplies
        // the body only when the manager has no usable translated body.
        if (!originalOnly && managerText === source) {
            const rtText = await rtTranslatedBody(full);
            if (currentLoreViewer?.overlay !== overlay) return;
            if (typeof rtText === 'string') renderLorePreview(body,rtText);
        }
    } catch {
        if (currentLoreViewer?.overlay!==overlay) return;
        title.textContent=displayWiTitle(entry);
        renderLorePreview(body,String(entry?.content ?? ''));
        schedulePlaceViewer();
    }
}

// SillyTavern emits activated scan candidates before final prompt assembly.
// Compare the post-regex content with the generation request; unreferenced outlets must not appear.
function promptTextParts(value) {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(promptTextParts);
    if (!value || typeof value !== 'object') return [];
    if (value.content !== undefined) return promptTextParts(value.content);
    if (typeof value.text === 'string') return [value.text];
    if (value.prompt !== undefined) return promptTextParts(value.prompt);
    if (value.input !== undefined) return promptTextParts(value.input);
    if (value.messages !== undefined) return promptTextParts(value.messages);
    if (value.chat !== undefined) return promptTextParts(value.chat);
    if (value.parts !== undefined) return promptTextParts(value.parts);
    return [];
}
function renderedWiContent(entry, preserveWhitespace = false) {
    if (!entry?.content || entry.disable === true) return '';
    if (entry.position === world_info_position.outlet && !entry.outletName) return '';
    try {
        const depth = entry.position === world_info_position.atDepth ? (entry.depth ?? 4) : null;
        const text = getRegexedString(entry.content, regex_placement.WORLD_INFO, {
            depth, isMarkdown: false, isPrompt: true,
        });
        return typeof text === 'string' ? (preserveWhitespace ? text : text.trim()) : '';
    } catch (error) {
        console.warn('🦥 WorldInfo Info', '[WorldInfo Info] Unable to verify entry content', error);
        return '';
    }
}
function captureWiCandidates(entryList,generationData,capture){
    if(!capture)return;
    const prompt=generationData?.prompt??generationData?.input;
    capture.setPrompt(Array.isArray(prompt)?requestTextParts(prompt):promptTextParts(prompt),null);
    for(const entry of entryList){
        if(capture.truncated)break;
        capture.add(entry,renderedWiContent(entry,true),entry.position===world_info_position.outlet);
    }
}

// The badge, reader list, slash command, report and Insight all consume the
// same verified request rows. Activation flags and arbitrary text hits are
// never admission evidence.
function applyConfirmedWiEntries(capture){
    return verifiedInsightRows(capture).map(row=>{
        const entry=row.entry;
        confirmedRenderedEntries.set(entry,row.text);
        if(row.outlet)confirmedOutletEntries.add(entry);
        return entry;
    });
}

let generationType;

const init = ()=>{
    if (window.STWII?.initialized) return;
    STWII.initialized = true;
    // Preserve legacy chat metadata without adding further raw logs.
    const trigger = document.createElement('div'); {
        trigger.classList.add('stwii--trigger');
        trigger.classList.add('fa-solid', 'fa-fw', 'fa-book-atlas');
        trigger.title = wiT('trigger.tooltip');
        trigger.draggable = false;
        // Disable native mobile browser dragging without touching the optional
        // extension-controlled drag mode or introducing an observer.
        trigger.addEventListener('dragstart', event => event.preventDefault());
        trigger.addEventListener('click', ()=>{
            const opened = panel.classList.toggle('stwii--isActive');
            // The latest scan is already captured; build the detail DOM only
            // when it is visible, before the first paint of the open panel.
            if (opened && panelNeedsRender) updatePanel(currentEntryList);
            requestAnimationFrame(ensurePanelsVisible);
            if (opened) scheduleTokenSummary();
        });
        trigger.addEventListener('contextmenu', (evt)=>{
            evt.preventDefault();
            clearTimeout(longPressTimer);
            if (Date.now() - lastLongPressMenuAt < 900) return;
            configPanel.classList.toggle('stwii--isActive');
            requestAnimationFrame(ensurePanelsVisible);
        });
        document.body.append(trigger);
    }
    const panel = document.createElement('div'); {
        panel.classList.add('stwii--panel');
        panel.textContent = '?';
        document.body.append(panel);
    }
    const configPanel = document.createElement('div'); {
        configPanel.classList.add('stwii--panel');
        const rowGroup = document.createElement('label'); {
            rowGroup.classList.add('stwii--configRow');
            rowGroup.title = wiT('settings.group.hint');
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.group ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.group = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                rowGroup.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = wiT('settings.group.label');
                rowGroup.append(lbl);
            }
            configPanel.append(rowGroup);
        }
        const orderRow = document.createElement('label'); {
            orderRow.classList.add('stwii--configRow');
            orderRow.title = wiT('settings.order.hint');
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.order ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.order = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                orderRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = wiT('settings.order.label');
                orderRow.append(lbl);
            }
            configPanel.append(orderRow);
        }
        const mesRow = document.createElement('label'); {
            mesRow.classList.add('stwii--configRow');
            mesRow.title = wiT('settings.messages.hint');
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.mes ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.mes = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                mesRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = wiT('settings.messages.label');
                mesRow.append(lbl);
            }
            configPanel.append(mesRow);
        }
        // Opt-in token total. OFF by default, no tokenizer work at boot or
        // during generation; only an opened list can start a single count.
        const tokenRow = document.createElement('label'); {
            tokenRow.classList.add('stwii--configRow');
            tokenRow.title = wiT('settings.tokens.hint');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = extension_settings.worldInfoInfo?.showTokenTotal ?? false;
            cb.addEventListener('change', () => {
                if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
                extension_settings.worldInfoInfo.showTokenTotal = cb.checked;
                syncTokenFooter();
                if (cb.checked) scheduleTokenSummary();
                saveSettingsDebounced();
                requestAnimationFrame(ensurePanelsVisible);
            });
            const lbl = document.createElement('div');
            lbl.textContent = wiT('settings.tokens.label');
            tokenRow.append(cb, lbl);
            configPanel.append(tokenRow);
        }
        // Display preference only. Reuse the existing list, never rescan lore.
        const originalRow = document.createElement('label'); {
            originalRow.classList.add('stwii--configRow');
            originalRow.title = wiT('settings.original.hint');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = showOriginalLore();
            cb.addEventListener('change', () => {
                if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
                extension_settings.worldInfoInfo.showOriginalLore = cb.checked;
                if (currentEntryList.length) updatePanel(currentEntryList);
                saveSettingsDebounced();
                requestAnimationFrame(ensurePanelsVisible);
            });
            const lbl = document.createElement('div');
            lbl.textContent = wiT('settings.original.label');
            originalRow.append(cb, lbl);
            configPanel.append(originalRow);
        }
        // Optional bridge to Lorebook Manager's standalone library. Disabled
        // unless explicitly selected; never starts a manager or AI task.
        const libraryRow = document.createElement('label'); {
            libraryRow.classList.add('stwii--configRow');
            libraryRow.title = wiT('settings.library.hint');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = extension_settings.worldInfoInfo?.linkLoreLibrary === true;
            cb.addEventListener('change', () => {
                if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
                extension_settings.worldInfoInfo.linkLoreLibrary = cb.checked;
                saveSettingsDebounced();
            });
            const lbl = document.createElement('div');
            lbl.textContent = wiT('settings.library.label');
            libraryRow.append(cb, lbl);
            configPanel.append(libraryRow);
        }
        // Drag-to-move toggle
        const dragRow = document.createElement('label'); {
            dragRow.classList.add('stwii--configRow');
            dragRow.title = wiT('settings.drag.hint');
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.drag ?? false;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
                    const wasEnabled = !!extension_settings.worldInfoInfo.drag;
                    extension_settings.worldInfoInfo.drag = cb.checked;

                    // If enabling for the first time and no saved position, convert current visual spot
                    const hasSaved = !!extension_settings.worldInfoInfo.triggerPos;
                    if (cb.checked && !wasEnabled && !hasSaved) {
                        materializeDefaultPosition();
                    }
                    saveSettingsDebounced();
                });
                dragRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = wiT('settings.drag.label');
                dragRow.append(lbl);
            }
            configPanel.append(dragRow);
        }
        // Replace the settings action; retain the recovery slash command.
        const insightButton = document.createElement('button');
        insightButton.type = 'button';
        insightButton.className = 'menu_button stwii--insight-button';
        insightButton.title = wiT('settings.insight.hint');
        const insightIcon = document.createElement('i');
        insightIcon.className = 'fa-solid fa-chart-simple';
        insightIcon.setAttribute('aria-hidden','true');
        const insightLabel = document.createElement('span');
        insightLabel.textContent = wiT('settings.insight.label');
        insightButton.append(insightIcon, insightLabel);
        insightButton.addEventListener('click', () => {
            configPanel.classList.remove('stwii--isActive');
            STWII.loreInsight?.open();
        });
        configPanel.append(insightButton);
        document.body.append(configPanel);
        STWII.trigger = trigger; STWII.panel = panel; STWII.configPanel = configPanel;
    }

    // Apply saved position if present
    {
        const savedPos = extension_settings.worldInfoInfo?.triggerPos;
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
            trigger.style.left = savedPos.left + 'px';
            trigger.style.top = savedPos.top + 'px';
            trigger.style.right = 'auto';
            trigger.style.bottom = 'auto';
        }
    }

    // One positioning coordinate system for the compact book button and both
    // popup panels. Konggomul's visualViewport bounds are used only on open,
    // on drag, and for viewport changes; there is no polling or DOM observer.
    function getVisibleBounds() {
        const vv = window.visualViewport;
        const left = Number(vv?.offsetLeft) || 0;
        const top = Number(vv?.offsetTop) || 0;
        const width = Math.max(1, Number(vv?.width) || window.innerWidth || 1);
        const height = Math.max(1, Number(vv?.height) || window.innerHeight || 1);
        return { left, top, width, height, right: left + width, bottom: top + height };
    }

    function clamp(val, min, max) {
        return Math.min(Math.max(Number.isFinite(val) ? val : min, min), Math.max(min, max));
    }

    function setTriggerPosition(left, top) {
        trigger.style.left = left + 'px';
        trigger.style.top = top + 'px';
        trigger.style.right = 'auto';
        trigger.style.bottom = 'auto';
    }

    function keepTriggerVisible() {
        const bounds = getVisibleBounds();
        const stored = extension_settings.worldInfoInfo?.triggerPos;
        const hasStored = Number.isFinite(stored?.left) && Number.isFinite(stored?.top);
        if (!hasStored) {
            // Always calculate from the CSS default; do not keep a temporary
            // keyboard-induced displacement after the keyboard closes.
            trigger.style.left = '';
            trigger.style.top = '';
            trigger.style.right = '';
            trigger.style.bottom = '';
        }
        const rect = trigger.getBoundingClientRect();
        const baseLeft = hasStored ? stored.left : rect.left;
        const baseTop = hasStored ? stored.top : rect.top;
        const margin = 4;
        const left = clamp(baseLeft, bounds.left + margin, bounds.right - rect.width - margin);
        const top = clamp(baseTop, bounds.top + margin, bounds.bottom - rect.height - margin);
        if (hasStored || Math.abs(left - rect.left) > 0.5 || Math.abs(top - rect.top) > 0.5) {
            setTriggerPosition(left, top);
        }
        // Viewport changes must not rewrite the user's saved coordinates.
    }

    function placePanelNearTrigger(el) {
        const bounds = getVisibleBounds();
        const margin = 3;
        const maxWidth = Math.max(1, Math.min(bounds.width * 0.8, bounds.width - 2 * margin));
        const maxHeight = Math.max(1, Math.min(bounds.height * 0.7, bounds.height - 2 * margin));
        el.style.setProperty('max-width', maxWidth + 'px', 'important');
        el.style.setProperty('max-height', maxHeight + 'px', 'important');
        const tr = trigger.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        const pw = rect.width;
        const ph = rect.height;

        // Prefer the side of the button with room. Keep the entire panel in
        // the visible mobile viewport (including after keyboard / rotation).
        const right = tr.right + margin;
        const left = tr.left - pw - margin;
        const x = right + pw <= bounds.right - margin ? right
            : left >= bounds.left + margin ? left
            : clamp(right, bounds.left + margin, bounds.right - pw - margin);

        // Align both the lore list and the settings menu to the book's top.
        // Clamp only when the complete panel would leave the visible viewport.
        const y = clamp(tr.top, bounds.top + margin, bounds.bottom - ph - margin);

        el.style.position = 'fixed';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }

    function ensurePanelsVisible() {
        keepTriggerVisible();
        if (panel.classList.contains('stwii--isActive')) placePanelNearTrigger(panel);
        if (configPanel.classList.contains('stwii--isActive')) placePanelNearTrigger(configPanel);
    }
    STWII.repairPositions = ensurePanelsVisible;

    function materializeDefaultPosition() {
        // Convert current visual placement (bottom/left CSS) to top/left pixels
        const rect = trigger.getBoundingClientRect();
        const left = rect.left;
        const top = rect.top;
        trigger.style.left = left + 'px';
        trigger.style.top = top + 'px';
        trigger.style.right = 'auto';
        trigger.style.bottom = 'auto';
        if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
        extension_settings.worldInfoInfo.triggerPos = { left, top };
    }

    let dragging = false;
    const touchDragThreshold = 12;
    let dragStartX = 0, dragStartY = 0;
    let baseLeft = 0, baseTop = 0;
    let movedEnough = false;
    let suppressNextClick = false;
    let longPressTimer = null;
    let longPressPointerId = null;
    let longPressStartX = 0;
    let longPressStartY = 0;
    let lastLongPressMenuAt = 0;

    function clearLongPress() {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        longPressPointerId = null;
    }
    function onLongPressPointerDown(e) {
        if (e.pointerType !== 'touch' || e.button !== 0) return;
        clearLongPress();
        longPressPointerId = e.pointerId;
        longPressStartX = e.clientX;
        longPressStartY = e.clientY;
        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            lastLongPressMenuAt = Date.now();
            suppressNextClick = true;
            // A stationary long press owns this gesture, even if the optional
            // button-drag setting is enabled. Finger jitter must not move it.
            dragging = false;
            movedEnough = false;
            trigger.style.touchAction = '';
            try { trigger.releasePointerCapture?.(longPressPointerId); } catch {}
            // A long press opens settings rather than also toggling the entry list.
            configPanel.classList.add('stwii--isActive');
            requestAnimationFrame(ensurePanelsVisible);
            setTimeout(() => { suppressNextClick = false; }, 850);
        }, 550);
    }
    function onLongPressPointerMove(e) {
        if (e.pointerId !== longPressPointerId) return;
        if (Math.abs(e.clientX - longPressStartX) > touchDragThreshold ||
            Math.abs(e.clientY - longPressStartY) > touchDragThreshold) clearLongPress();
    }

    function onPointerDown(e) {
        if (!(extension_settings.worldInfoInfo?.drag)) return; // dragging disabled
        if (e.button !== 0 && e.pointerType !== 'touch') return; // left mouse or touch
        dragging = true;
        movedEnough = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        // compute current position
        const rect = trigger.getBoundingClientRect();
        baseLeft = rect.left;
        baseTop = rect.top;

        trigger.style.touchAction = 'none';
        trigger.setPointerCapture?.(e.pointerId);
        e.preventDefault();
    }

    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const threshold = e.pointerType === 'touch' ? touchDragThreshold : 4;
        if (!movedEnough && (Math.abs(dx) > threshold || Math.abs(dy) > threshold)) movedEnough = true;
        if (!movedEnough) return;

        const bounds = getVisibleBounds();
        const newLeft = clamp(baseLeft + dx, bounds.left + 4, bounds.right - trigger.offsetWidth - 4);
        const newTop = clamp(baseTop + dy, bounds.top + 4, bounds.bottom - trigger.offsetHeight - 4);
        setTriggerPosition(newLeft, newTop);
    }

    function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        trigger.releasePointerCapture?.(e.pointerId);
        trigger.style.touchAction = '';

        // persist if moved
        if (movedEnough) {
            const rect = trigger.getBoundingClientRect();
            if (!extension_settings.worldInfoInfo) extension_settings.worldInfoInfo = {};
            extension_settings.worldInfoInfo.triggerPos = { left: rect.left, top: rect.top };
            saveSettingsDebounced();
            suppressNextClick = true;
            setTimeout(() => suppressNextClick = false, 250);
        }

        // Re-place open panels after drag
        requestAnimationFrame(ensurePanelsVisible);
    }

    trigger.addEventListener('pointerdown', onLongPressPointerDown);
    trigger.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onLongPressPointerMove);
    window.addEventListener('pointerup', clearLongPress);
    window.addEventListener('pointercancel', clearLongPress);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    // Prevent click toggle if a drag just occurred (capture phase)
    trigger.addEventListener('click', (e) => {
        if (suppressNextClick) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);

    // One coalesced reposition per viewport change, never a full list redraw.
    let positionRepairFrame = null;
    function schedulePositionRepair() {
        if (positionRepairFrame !== null) return;
        positionRepairFrame = requestAnimationFrame(() => {
            positionRepairFrame = null;
            ensurePanelsVisible();
        });
    }
    window.addEventListener('resize', schedulePositionRepair, { passive: true });
    window.addEventListener('orientationchange', schedulePositionRepair, { passive: true });
    window.visualViewport?.addEventListener?.('resize', schedulePositionRepair, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', schedulePositionRepair, { passive: true });
    schedulePositionRepair();

    let entries = [];

    let count = -1;
    let badgeToken = 0;
    const updateBadge = async(newEntries) => {
        const token = ++badgeToken;
        const oldCount = count;
        const previousEntries = new Set(entries);
        const changedEntries = newEntries.some(id => !previousEntries.has(id));
        count = newEntries.length;
        entries = [...newEntries];
        trigger.classList.remove('stwii--badge-in', 'stwii--badge-out', 'stwii--badge-bounce');
        if (oldCount !== count) {
            if (count === 0) {
                trigger.setAttribute('data-stwii--badge-count', '0');
            } else {
                const cls = oldCount === 0 ? 'stwii--badge-in' : 'stwii--badge-bounce';
                trigger.setAttribute('data-stwii--badge-count', String(count));
                trigger.classList.add(cls);
                await delay(cls === 'stwii--badge-in' ? 510 : 1010);
                if (token === badgeToken) trigger.classList.remove(cls);
            }
        } else if (changedEntries) {
            trigger.classList.add('stwii--badge-bounce');
            await delay(1010);
            if (token === badgeToken) trigger.classList.remove('stwii--badge-bounce');
        }
    };
    let currentEntryList = [];
    let currentChat = [];
    let currentChatNote = '';
    let currentChatNoteDepth;
    let panelNeedsRender = false;
    let pendingEntries = [];
    let promptTrace=null;
    let noteBeforeScan=null;
    function releasePromptTrace(){promptTrace?.release();promptTrace=null;}
    let generationSerial = 0;
    let realGenerationInProgress = false;
    let stopConsoleCapture = null;
    const jevRecall = createJevRecallReceipts();
    const recordStloJevRecall = (lists, appliedKeys) => {
        if (!realGenerationInProgress || stwiiDryRunActive) return false;
        return jevRecall.record(lists, appliedKeys);
    };
    STWII.recordStloJevRecall = recordStloJevRecall;
    const onWorldInfoEntriesLoaded = (lists) => {
        if (!realGenerationInProgress || stwiiDryRunActive) return;
        jevRecall.consume(lists);
        const note=extension_prompts?.['2_floating_prompt']?.value;
        noteBeforeScan=typeof note==='string'&&note.length<=524288?note:null;
    };
    const resetJevRecall = () => jevRecall.reset();
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoEntriesLoaded);

    let lastReportBuild = null;
    let lastLiveReport = null;
    let observedActivatedCount = null;
    let lastRenderedGenerationEntries = null;
    let finalizedTokenGeneration = -1;
    let tokenGenerationAwaitingEnd = false;
    let tokenSummary = null;          // { serial, count }, count null means unavailable
    let tokenSummaryPending = -1;
    let tokenSummaryRequest = 0;
    let tokenFooter = null;
    // Capture the generation's tokenizer context. Share exact-input promises
    // only for the known OpenAI-compatible tokenizer path.
    function loreTokenScope() {
        try {
            const ctx=getContext();
            if(!ctx?.mainApi||!ctx.powerUserSettings)return null;
            const api=ctx.mainApi,model=api==='openai'?ctx.getTokenizerModel?.():ctx.onlineStatus;
            if(api==='openai'&&!model)return null;
            return JSON.stringify([generationSerial,getCurrentChatId(),api,
                ctx.chatCompletionSettings?.chat_completion_source,ctx.textCompletionSettings?.type,
                model,ctx.powerUserSettings.tokenizer,ctx.characterId??null,ctx.groupId??null]);
        }catch{return null;}
    }
    function sharedLoreTokenScope(){
        try{return getContext()?.mainApi==='openai'?loreTokenScope():null;}catch{return null;}
    }
    const insightTokens=createInsightTokenCache(getTokenCountAsync,sharedLoreTokenScope);
    const insight = createLoreInsight({
        t: wiT, countText: insightTokens.countText, getScope: loreTokenScope,
        getChatId: getCurrentChatId,
        getReason: entry => insightReason(entry, displayedActivationEvents.get(entry)),
        titleFor: displayWiTitle,
        isVisible: world => canShowInsightWorld(world, isAdmin(),
            typeof getCurrentUserHandle === 'function' ? getCurrentUserHandle() : ''),
        reasonLabel: reason => reason === 'multiple' ? wiT('insight.multiple') : wiT('reader.reason.' + reason),
        reasonIcons: entry => insightReasonCodes(entry,displayedActivationEvents.get(entry)).map(reason=>({
            key:reason,
            icon:({constant:strategy.constant,keyword:strategy.normal,vector:strategy.vectorized,
                jev:strategy.jev.split(' ')[0],sticky:'📌',decorator:'🪄',external:'⚡',unknown:'❔'})[reason],
            label:wiT('reader.reason.'+reason),
        })),
        watchRequest: (listener, before) => {
            const event=event_types.CHAT_COMPLETION_SETTINGS_READY;
            if(!event)return null;
            if(typeof eventSource.makeFirst==='function')eventSource.makeFirst(event,before);
            if(typeof eventSource.makeLast==='function')eventSource.makeLast(event,listener);
            else eventSource.on(event,listener);
            return ()=>{
                eventSource.removeListener?.(event,before);
                eventSource.removeListener?.(event,listener);
            };
        },
    });
    STWII.loreInsight = insight;
    const tokenBridge = Object.freeze({ apiVersion: 1, count: insightTokens.countText });
    STWII.loreTokenCountV1 = tokenBridge;


    const showTokenTotal = () => extension_settings.worldInfoInfo?.showTokenTotal === true;
    // Only show the result after a real, nonempty injection has been counted.
    // No placeholder, empty-chat footer, observer, or additional scanning.
    function syncTokenFooter() {
        if (!showTokenTotal() || currentEntryList.length === 0 ||
            realGenerationInProgress || tokenGenerationAwaitingEnd ||
            finalizedTokenGeneration !== generationSerial ||
            tokenSummary?.serial !== generationSerial ||
            !Number.isFinite(tokenSummary.count)) {
            tokenFooter?.remove();
            tokenFooter = null;
            return;
        }
        if (!tokenFooter || tokenFooter.parentElement !== panel) {
            tokenFooter = document.createElement('div');
            tokenFooter.className = 'stwii--token-total';
            const value = document.createElement('span');
            value.className = 'stwii--token-total-value';
            tokenFooter.append(value);
            panel.append(tokenFooter);
        } else if (tokenFooter !== panel.lastElementChild) {
            panel.append(tokenFooter);
        }
        tokenFooter.lastElementChild.textContent = 'Total ' + tokenSummary.count.toLocaleString();
    }
    function scheduleTokenSummary() {
        if (!showTokenTotal() || currentEntryList.length === 0 ||
            !panel.classList.contains('stwii--isActive') ||
            realGenerationInProgress || tokenGenerationAwaitingEnd ||
            finalizedTokenGeneration !== generationSerial ||
            tokenSummary?.serial === generationSerial || tokenSummaryPending === generationSerial) return;

        const serial = generationSerial;
        const chatId = getCurrentChatId();
        const request = ++tokenSummaryRequest;
        tokenSummaryPending = serial;
        syncTokenFooter();
        // Defer beyond the first paint: opening the book stays instantaneous.
        // Compute exactly one combined count, not one request per entry.
        requestAnimationFrame(() => setTimeout(async () => {
            if (request !== tokenSummaryRequest || serial !== generationSerial ||
                chatId !== getCurrentChatId() || !showTokenTotal() ||
                !panel.classList.contains('stwii--isActive') ||
                realGenerationInProgress || tokenGenerationAwaitingEnd ||
                finalizedTokenGeneration !== serial) {
                if (request === tokenSummaryRequest) {
                    tokenSummaryPending = -1;
                    syncTokenFooter();
                }
                return;
            }
            let count = null;
            try {
                const texts = currentEntryList.filter(entry => entry?.type === 'wi')
                    .map(entry=>confirmedRenderedEntries.get(entry)).filter(Boolean);
                const result = texts.length ? await insightTokens.countText(texts.join('\n')) : 0;
                if (Number.isFinite(result) && result >= 0) count = Math.round(result);
            } catch {
                // Counting is optional. A tokenizer error must never affect lore.
            }
            if (request !== tokenSummaryRequest || serial !== generationSerial ||
                chatId !== getCurrentChatId()) return;
            tokenSummaryPending = -1;
            tokenSummary = { serial, count };
            syncTokenFooter();
            if (panel.classList.contains('stwii--isActive')) requestAnimationFrame(ensurePanelsVisible);
        }, 0));
    }
    // This is the exact number of messages used by the last real WI scan.
    // SillyTavern already logs it; no chat/history scan is needed.
    let stwiiCurrentScanMessageCount = null;
    // Publish only the verified request result; defer hidden detail DOM construction.
    function renderGenerationEntries(list) {
        const signature = generationSerial + ':' + list.map(entry =>
            String(entry.world) + '§§§' + String(entry.uid) + '§§§' + String(entry.sticky || 0) + '§§§' + (entry.stwiiJevRecall === true ? 'jev' : '')).join('|');
        currentEntryList = [...list];
        if (signature === lastRenderedGenerationEntries) return;
        lastRenderedGenerationEntries = signature;
        void updateBadge(list.map(entry => String(entry.world) + '§§§' + String(entry.uid)));
        if (list.length) updatePanel(list, true);
        else { panelNeedsRender = false; panel.textContent = wiT('panel.noneVerified'); tokenFooter = null; }
        syncTokenFooter();
    }

    const beginRealGeneration = (type, options, dryRun) => {
        // Token-count passes and background/quiet generations aren't the
        // on-screen reply. Neither should replace the most recent displayed
        // reply's World Info. A quietToLoud generation *is* user-visible.
        if (dryRun || (type === 'quiet' && !options?.quietToLoud)) return;
        generationSerial++;
        insight.start();
        insightTokens.clear();
        generationType = type;
        releasePromptTrace();
        noteBeforeScan=null;
        jevRecall.reset();
        realGenerationInProgress = true;
        startWorldInfoConsoleCapture();
        stwiiDryRunActive = false;
        tokenGenerationAwaitingEnd = true;
        tokenSummaryRequest++;
        tokenSummaryPending = -1;
        tokenSummary = null;
        finalizedTokenGeneration = -1;
        syncTokenFooter();
        pendingEntries = [];
        observedActivatedCount = null;
        stwiiCurrentScanMessageCount = null;
        lastReportBuild = null;
        stwiiCurrentBuild = null;
        activationDrafts.clear();
        vectorActivatedIds.clear();
        lastWorldByUid.clear();
        stwiiCurrentLoopCounts = null;
        stwiiCurrentLoopEntryIds = null;
        stwiiCurrentLoopEventIds = null;
        stwiiActiveLoopIndex = -1;

        // Do not show the previous reply's rows as this reply's insertion.
        renderGenerationEntries([]);
        panel.textContent=wiT('panel.waiting');
        lastRenderedGenerationEntries=null;
    };

    eventSource.on(event_types.GENERATION_STARTED, beginRealGeneration);
    const onChatChanged = () => {
        insight.clear();
        insightTokens.clear();
        generationSerial++;
        jevRecall.reset();
        realGenerationInProgress = false;
        releaseWorldInfoConsoleCapture();
        releasePromptTrace();noteBeforeScan=null;
        tokenGenerationAwaitingEnd = false;
        tokenSummaryRequest++;
        tokenSummaryPending = -1;
        tokenSummary = null;
        finalizedTokenGeneration = -1;
        pendingEntries = [];
        stwiiCurrentScanMessageCount = null;
        currentEntryList = [];
        currentChat = [];
        currentChatNote = '';
        currentChatNoteDepth = undefined;
        panelNeedsRender = false;
        lastRenderedGenerationEntries = null;
        lastReportBuild = null;
        lastLiveReport = null;
        observedActivatedCount = null;
        stwiiCurrentBuild = null;
        activationDrafts.clear();
        vectorActivatedIds.clear();
        lastWorldByUid.clear();
        stwiiCurrentLoopCounts = null;
        stwiiCurrentLoopEntryIds = null;
        stwiiCurrentLoopEventIds = null;
        stwiiActiveLoopIndex = -1;
        panel.textContent = '?';
        tokenFooter = null;
        syncTokenFooter();
        void updateBadge([]);
    };
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Activation events describe scan candidates, not actual final prompt insertion.
    const onWorldInfoActivated = (entryList) => {
        if (!realGenerationInProgress || stwiiDryRunActive) return;
        observedActivatedCount = Array.isArray(entryList) ? entryList.length : null;
        if(!Array.isArray(entryList))return;

        // SillyTavern has already checked and stored timed effects during this
        // WI scan. Read its in-memory end count directly rather than invoking a
        // slash command that reloads the entire lorebook for EVERY entry.
        const effectByEntry = chat_metadata.timedWorldInfo?.sticky;
        const scanned = stwiiCurrentScanMessageCount;
        const filtered = entryList.filter(e => e?.disable !== true)
            .map(entry => {
                const effect = effectByEntry?.[String(entry.world) + '.' + String(entry.uid)];
                const end = Number(effect?.end);
                const remaining = Number.isInteger(scanned) && scanned >= 0
                    && Number.isFinite(end) ? Math.max(0, Math.trunc(end - scanned)) : 0;
                const snapshot = jevRecall.annotate(entry);
                snapshot.type = 'wi';
                snapshot.sticky = remaining;
                // A new, not-yet-finalized snapshot must not reuse old reasons.
                displayedActivationEvents.set(snapshot, null);
                return snapshot;
            });
        pendingEntries = filtered;
        // Native assembly starts after this event; no temporary hooks during
        // the scan or Jev requests, or when there are no candidates to verify.
        releasePromptTrace();
        if(filtered.length&&main_api==='openai')promptTrace=observePromptAssembly(promptManager,()=>extension_prompts,generationType,noteBeforeScan,insightOpenAI.Message);
        // Never publish scan candidates, even for ordinary or constant lore.
    };
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);

    const onGenerateAfterData = (data, dryRun) => {
        if(dryRun||!realGenerationInProgress)return;
        realGenerationInProgress=false;
        releaseWorldInfoConsoleCapture();
        const candidates=pendingEntries,serial=generationSerial,chatId=getCurrentChatId();
        const build=lastReportBuild?.chatId===chatId?lastReportBuild:null;
        const complete=canReplaceReport(build,observedActivatedCount,candidates);
        const captured=build??stwiiCurrentBuild;
        let trace=null,insightCapture=null;
        try{trace=promptTrace?.take(data?.prompt)??null;}catch{releasePromptTrace();}
        promptTrace=null;
        try{
            insightCapture=STWII.loreInsight?.beginCapture(serial,chatId,observedActivatedCount);
            captureWiCandidates(candidates,data,insightCapture);
        }catch{}
        noteBeforeScan=null;
        pendingEntries=[];jevRecall.reset();
        finalizedTokenGeneration=serial;
        syncTokenFooter();

        // Keep activation reasons available for both the confirmed entries
        // and the separate diagnostic lists. Do not save raw prompts.
        const eventsById=new Map();
        for(const ev of captured?.added??[]){
            const id=JSON.stringify([ev.world,ev.uid]);
            if(!eventsById.has(id))eventsById.set(id,ev);
        }
        for(const entry of candidates){
            const ev=eventsById.get(JSON.stringify([entry.world,entry.uid]));
            displayedActivationEvents.set(entry,ev??null);
        }
        function finalizeVerified(capture){
            if(serial!==generationSerial||chatId!==getCurrentChatId())return;
            const included=applyConfirmedWiEntries(capture);
            renderGenerationEntries(included);
            const ids=new Set(included.map(it=>String(it.world)+':'+String(it.uid)));
            const jevIds=new Set(included.filter(entry=>entry.stwiiJevRecall===true)
                .map(entry=>String(entry.world)+':'+String(entry.uid)));
            const added=(captured?.added??[]).filter(ev=>ids.has(String(ev.world)+':'+String(ev.uid)))
                .map(ev=>jevIds.has(String(ev.world)+':'+String(ev.uid))
                    ?{...ev,jevConfirmed:true,logic:'JEV',reason:'jev',primary:null,secondary:[],vectorConfirmed:false}:ev);
            const reportComplete=complete&&capture?.rows.length===candidates.length&&hasCompleteEvidence(capture);
            const originalLoops=build?.loopEntryIds;
            const loopEntryIds=Array.isArray(originalLoops)&&originalLoops.every(Array.isArray)
                ?originalLoops.map(group=>group.filter(id=>ids.has(id))):[];
            lastLiveReport={
                runId:captured?.runId??Date.now(),chatId,added,logs:captured?.logs??[],
                loopCounts:loopEntryIds.map(group=>group.length),loopEntryIds,incomplete:!reportComplete,
            };
            try{persistReport(chat_metadata,lastLiveReport,reportComplete);}
            catch(error){console.warn('🦥 WorldInfo Info','[WorldInfo Info] Report storage failed; previous metadata retained',error);}
        }
        try{
            if(insightCapture)STWII.loreInsight?.finish(insightCapture,complete,main_api==='openai'
                ?{messages:data?.prompt,type:generationType,structure:trace?.structure??null,trace,
                    squashed:getContext()?.chatCompletionSettings?.squash_system_messages===true,
                    beforePosition:world_info_position.before,afterPosition:world_info_position.after,
                    depthPosition:world_info_position.atDepth,anTopPosition:world_info_position.ANTop,
                    anBottomPosition:world_info_position.ANBottom,
                    formatWorldInfo:insightOpenAI.formatWorldInfo}:null,finalizeVerified);
            else finalizeVerified(null);
        }catch{finalizeVerified(null);}
        lastReportBuild=null;stwiiCurrentBuild=null;
    };
    eventSource.on(event_types.GENERATE_AFTER_DATA, onGenerateAfterData);

    // Wait for the actual reply to finish (not prompt construction). This
    // single event callback only schedules work when the opt-in list is open.
    const onCompletedGeneration = () => {
        releaseWorldInfoConsoleCapture();
        releasePromptTrace();noteBeforeScan=null;
        if (!tokenGenerationAwaitingEnd || realGenerationInProgress ||
            finalizedTokenGeneration !== generationSerial) return;
        tokenGenerationAwaitingEnd = false;
        insight.ready();
        syncTokenFooter();
        if (panel.classList.contains('stwii--isActive')) scheduleTokenSummary();
    };
    eventSource.on(event_types.GENERATION_ENDED, onCompletedGeneration);
    eventSource.on(event_types.MESSAGE_RECEIVED, onCompletedGeneration);
    const onGenerationStopped = () => {
        insight.clear();
        insightTokens.clear();
        resetJevRecall();
        releaseWorldInfoConsoleCapture();
        releasePromptTrace();noteBeforeScan=null;
        renderGenerationEntries([]);
        if (!realGenerationInProgress && !tokenGenerationAwaitingEnd) return;
        realGenerationInProgress = false;
        pendingEntries = [];
        tokenGenerationAwaitingEnd = false;
        finalizedTokenGeneration = -1;
        tokenSummaryRequest++;
        tokenSummaryPending = -1;
        tokenSummary = null;
        syncTokenFooter();
    };
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);

    function updatePanel(entryList, newChat = false) {
        if (newChat) {
            // Capture the scan-time text/depth, not a later streamed reply or
            // edited message when the user eventually opens the book.
            currentChat = chat.map(message => ({ mes: message.mes }));
            if (generationType === 'swipe') currentChat.pop();
            currentChatNote = chat_metadata[metadata_keys.prompt];
            currentChatNoteDepth = chat_metadata[metadata_keys.depth];
        }
        panelNeedsRender = true;
        if (!panel.classList.contains('stwii--isActive')) return;
        renderPanelContents(entryList);
        panelNeedsRender = false;
    }

    const renderPanelContents = (entryList)=>{
        const isGrouped = extension_settings.worldInfoInfo?.group ?? true;
        const isOrdered = extension_settings.worldInfoInfo?.order ?? true;
        const isMes = extension_settings.worldInfoInfo?.mes ?? true;
        panel.innerHTML = '';
        const adminBypass = isAdmin();

        // Panel-only per-user visibility for Z- lorebooks.
        // - Exempt "9Z Universal Commands" (visible to everyone)
        // - Z-<handle>-* is visible only to matching user (admins see all)
        // - Other 9Z remain hidden for non-admins
        const norm = (s) => (typeof s === 'string' ? s : '').trim();

        // Extract single handle after "Z-", e.g. "Z-alice-..." => "alice"
        // Allows "Z-alice" (no trailing dash) as well.
        const extractZHandle = (world) => {
            const m = norm(world).match(/^Z-([^-\s]+)(?:-|$)/);
            return m ? m[1] : null;
        };

        // Provided by the host app; fallback to empty if unavailable.
        const currentHandle = (typeof getCurrentUserHandle === 'function' ? getCurrentUserHandle() : '')
            .trim();

        const isHiddenWorld = (w)=> {
            const s = norm(w);
            if (s === '9Z Universal Commands') return false; // exemption

            // Per-user visibility for Z- lorebooks:
            const h = extractZHandle(s);
            if (h) {
                // Hide if the embedded handle does not match the current user
                return h !== currentHandle;
            }

            // Keep other 9Z hidden for non-admins
            return s.startsWith('9Z');
        };
        let grouped;
        if (isGrouped) {
            grouped = Object.groupBy(entryList, (it,idx)=>it.world);
        } else {
            grouped = {
                [wiT('panel.ungrouped')]: [...entryList],
            };
        }
        const depthPos = [world_info_position.ANBottom, world_info_position.ANTop, world_info_position.atDepth];
        for (const [world, entries] of Object.entries(grouped)) {
            for (const e of entries) {
                e.depth = e.position == world_info_position.atDepth ? e.depth : (currentChatNoteDepth + (e.position == world_info_position.ANTop ? 0.1 : 0));
            }
            const w = document.createElement('div'); {
                w.classList.add('stwii--world');
                w.textContent = world;
                panel.append(w);
                if (!adminBypass && isGrouped && isHiddenWorld(world)) {
                    const placeholder = document.createElement('div'); {
                        placeholder.classList.add('stwii--entry');
                        placeholder.title = '';
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            placeholder.append(strat);
                        }
                        const title = document.createElement('div'); {
                            title.classList.add('stwii--title');
                            title.textContent = wiT('panel.hidden');
                            placeholder.append(title);
                        }
                        const sticky = document.createElement('div'); {
                            sticky.classList.add('stwii--sticky');
                            sticky.textContent = '';
                            sticky.title = '';
                            placeholder.append(sticky);
                        }
                        panel.append(placeholder);
                    }
                    continue;
                }
                entries.sort((a,b)=>{
                    if (isOrdered) {
                        // order by strategy / depth / order
                        const aDepthPos = depthPos.includes(a.position);
                        const bDepthPos = depthPos.includes(b.position);
                        if (!aDepthPos && !bDepthPos && a.position !== b.position) return a.position - b.position;
                        if (aDepthPos && !bDepthPos) return 1;
                        if (!aDepthPos && bDepthPos) return -1;
                        if (aDepthPos && bDepthPos && (a.depth ?? Number.MAX_SAFE_INTEGER) < (b.depth ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if (aDepthPos && bDepthPos && (a.depth ?? Number.MAX_SAFE_INTEGER) > (b.depth ?? Number.MAX_SAFE_INTEGER)) return -1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) > (b.order ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) < (b.order ?? Number.MAX_SAFE_INTEGER)) return -1;
                        return displayWiTitle(a).toLowerCase().localeCompare(displayWiTitle(b).toLowerCase());
                    } else {
                        // order alphabetically
                        return displayWiTitle(a).toLowerCase().localeCompare(displayWiTitle(b).toLowerCase())
                        ;
                    }
                });
                if (!isGrouped && isOrdered && isMes) {
                    const an = currentChatNote;
                    const ad = currentChatNoteDepth;
                    if (an?.length) {
                        const idx = entries.findIndex(e=>depthPos.includes(e.position) && e.depth <= ad);
                        entries.splice(idx, 0, {
                            type: 'note',
                            position: world_info_position.ANBottom,
                            depth: ad,
                            text: an,
                        });
                    }
                    const segmenter = new Intl.Segmenter('en', { granularity:'sentence' });
                    let currentDepth = currentChat.length - 1;
                    let isDumped = false;
                    for (let i = entries.length - 1; i >= -1; i--) {
                        if (i < 0 && currentDepth < 0) continue;
                        if (isDumped) continue;
                        if ((i < 0 && currentDepth >= 0) || !depthPos.includes(entries[i].position)) {
                            // anything not @D is considered as "before chat"
                            isDumped = true;
                            const depth = -1;
                            const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                            const text = mesList
                                .map(it=>it.mes)
                                .map(it=>it
                                    .replace(/```.+```/gs, '')
                                    .replace(/<[^>]+?>/g, '')
                                    .trim()
                                    ,
                                )
                                .filter(it=>it.length)
                                .join('\n')
                            ;
                            const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                            entries.splice(i + 1, 0, {
                                type: 'mes',
                                count: mesList.length,
                                from: depth + 1,
                                to: currentDepth,
                                first: sentences.at(0),
                                last: sentences.length > 1 ? sentences.at(-1) : null,
                            });
                            currentDepth = -1;
                            continue;
                        }
                        let depth = Math.max(-1, currentChat.length - entries[i].depth - 1);
                        if (depth >= currentDepth) continue;
                        depth = Math.ceil(depth);
                        if (depth == currentDepth) continue;
                        const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                        const text = mesList
                            .map(it=>it.mes)
                            .map(it=>it
                                .replace(/```.+```/gs, '')
                                .replace(/<[^>]+?>/g, '')
                                .trim()
                                ,
                            )
                            .filter(it=>it.length)
                            .join('\n')
                        ;
                        const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                        entries.splice(i + 1, 0, {
                            type: 'mes',
                            count: mesList.length,
                            from: depth + 1,
                            to: currentDepth,
                            first: sentences.at(0),
                            last: sentences.length > 1 ? sentences.at(-1) : null,
                        });
                        currentDepth = depth;
                    }
                }
                let hadHidden = false;
                for (const entry of entries) {
                    if (!adminBypass && !isGrouped && isHiddenWorld(entry.world)) { hadHidden = true; continue; }
                    const e = document.createElement('div'); {
                        e.classList.add('stwii--entry');
                        const wipChar = [world_info_position.before, world_info_position.after];
                        if (entry.type === 'wi') {
                            e.classList.add('stwii--actionable');
                            e.tabIndex = 0;
                            e.setAttribute('role', 'button');
                            e.addEventListener('click', () => void showInjectedLore(entry));
                            e.addEventListener('keydown', (event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                void showInjectedLore(entry);
                            });
                        }
                        const wipEx = [world_info_position.EMTop, world_info_position.EMBottom];
                        e.title = '';
                        if (entry.type == 'mes') e.classList.add('stwii--messages');
                        if (entry.type == 'note') e.classList.add('stwii--note');
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            if (entry.type == 'wi') {
                                const entryStrategy = getStrategy(entry);
                                strat.textContent = strategy[entryStrategy];
                                if (entryStrategy === 'jev') {
                                    strat.setAttribute('role', 'img');
                                    strat.setAttribute('aria-label', wiT('reader.reason.jev'));
                                }
                            } else if (entry.type == 'mes') {
                                strat.textContent = wiT('entry.message.count', entry.count);
                            } else if (entry.type == 'note') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-note-sticky');
                            }
                            e.append(strat);
                        }
                        const title = document.createElement('div'); {
                            title.classList.add('stwii--title');
                            if (entry.type == 'wi') {
                                title.textContent = displayWiTitle(entry);
                                e.title = '[' + entry.world + '] ' + displayWiTitle(entry);
                                if (entry.stwiiJevRecall === true) e.title += '\n' + wiT('reader.reason.jev');
                            } else if (entry.type == 'mes') {
                                const first = document.createElement('div'); {
                                    first.classList.add('stwii--first');
                                    first.textContent = entry.first;
                                    title.append(first);
                                }
                                if (entry.last) {
                                    e.title = wiT('entry.message.range', entry.from, entry.to) + '\n---\n' + entry.first + '\n...\n' + entry.last;
                                    const sep = document.createElement('div'); {
                                        sep.classList.add('stwii--sep');
                                        sep.textContent = '...';
                                        title.append(sep);
                                    }
                                    const last = document.createElement('div'); {
                                        last.classList.add('stwii--last');
                                        last.textContent = entry.last;
                                        title.append(last);
                                    }
                                } else {
                                    e.title = wiT('entry.message.one', entry.from) + '\n---\n' + entry.first;
                                }
                            } else if (entry.type == 'note') {
                                title.textContent = wiT('entry.note');
                                e.title = wiT('entry.note') + '\n---\n' + entry.text;
                            }
                            e.append(title);
                        }
                        const sticky = document.createElement('div'); {
                            sticky.classList.add('stwii--sticky');
                            sticky.textContent = entry.sticky ? `📌 ${entry.sticky}` : '';
                            sticky.title = wiT('entry.sticky', entry.sticky);
                            e.append(sticky);
                        }
                        panel.append(e);
                    }
                }
                if (!adminBypass && !isGrouped && hadHidden) {
                    const placeholder = document.createElement('div'); {
                        placeholder.classList.add('stwii--entry');
                        placeholder.title = '';
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            placeholder.append(strat);
                        }
                        const title = document.createElement('div'); {
                            title.classList.add('stwii--title');
                            title.textContent = wiT('panel.hidden');
                            placeholder.append(title);
                        }
                        const sticky = document.createElement('div'); {
                            sticky.classList.add('stwii--sticky');
                            sticky.textContent = '';
                            sticky.title = '';
                            placeholder.append(sticky);
                        }
                        panel.append(placeholder);
                    }
                }
            }
        }
        syncTokenFooter();
    };

    // Raw console lines are transient; only a compact keyword report is saved.
    let stwiiCurrentBuild = null;
    // Per-run loop counts (for latest non-dry run), and dry-run flag
    let stwiiCurrentLoopCounts = null;
    // Per-run loop entry IDs (exact order for each loop, from engine array dumps)
    let stwiiCurrentLoopEntryIds = null;
    // Per-run loop entry IDs captured incrementally during LOOP START/RESULT using activation commits
    let stwiiCurrentLoopEventIds = null;
    // Currently active loop index (-1 when not within a loop)
    let stwiiActiveLoopIndex = -1;
    let stwiiDryRunActive = false;
function startBuildSession(startedFromScan = false) {
        STWII.currentRunId = Date.now();
        lastReportBuild = null;
        if (startedFromScan) {
            observedActivatedCount = null;
            pendingEntries = [];
            stwiiCurrentLoopEventIds = [];
            stwiiActiveLoopIndex = -1;
        }
        stwiiCurrentBuild = { runId: STWII.currentRunId, startedFromScan, finished: false, finalCount: null, added: [], logs: [] };
    }
function endBuildSession() {
        if (!stwiiCurrentBuild) return;
        stwiiCurrentBuild.chatId = getCurrentChatId();
        stwiiCurrentBuild.finished = true;
        const counts = Array.isArray(stwiiCurrentLoopCounts) ? [...stwiiCurrentLoopCounts] : [];
        stwiiCurrentBuild.loopCounts = counts;
        stwiiCurrentBuild.loopEntryIds = counts.map((count, i) => {
            const captured = stwiiCurrentLoopEventIds?.[i];
            const fallback = stwiiCurrentLoopEntryIds?.[i];
            const ids = Array.isArray(captured) && captured.length === count ? captured
                : Array.isArray(fallback) && fallback.length === count ? fallback : null;
            return ids ? [...ids] : null;
        });
        lastReportBuild = stwiiCurrentBuild;
        stwiiCurrentBuild = null;
    }

    // WI activation log capture (no changes to world-info.js)
    const activationDrafts = new Map();
    const vectorActivatedIds = new Set();
    // Track last seen world for a given numeric UID (engine logs sometimes omit the world on follow-up lines)
    const lastWorldByUid = new Map();

    // Build composite key helper "World:UID" or placeholder "?:UID" when world is unknown
    function makeDraftKey(uid, world) {
        const w = (typeof world === 'string' && world.length) ? world : null;
        return w ? `${w}:${uid}` : `?:${uid}`;
    }
    function parseWiUIDFromFirstArg(a0) {
        if (typeof a0 !== 'string') return null;
        const m = a0.match(/\[WI\]\s+Entry\s+(\d+)/);
        return m ? Number(m[1]) : null;
    }
    function upsertDraft(uid, worldOpt) {
        // Prefer explicit world; fallback to last seen for this uid
        const world = worldOpt || lastWorldByUid.get(uid) || null;

        // If we now know the world, migrate any placeholder draft (?:uid) to composite
        const placeholderKey = makeDraftKey(uid, null);
        const key = makeDraftKey(uid, world);

        if (world && activationDrafts.has(placeholderKey) && !activationDrafts.has(key)) {
            activationDrafts.set(key, activationDrafts.get(placeholderKey));
            activationDrafts.delete(placeholderKey);
        }

        if (!activationDrafts.has(key)) {
            activationDrafts.set(key, { primary: null, secondary: [], secondaryNon: [], logic: null });
        }
        return activationDrafts.get(key);
    }
    function handleWiDebugArgs(args) {
        if (!args || args.length === 0) return;
        const a0 = args[0];

        const header=typeof args[1]==='string'&&args[1].includes(' processing')?args[2]:null;
        if(header&&typeof header.world==='string'&&header.uid!=null)lastWorldByUid.set(Number(header.uid),header.world);

        // The vector extension reports its own matches before issuing the
        // generic force-activation event. An entry's vectorized flag alone
        // does NOT prove that its vector search matched on this generation.
        if (typeof a0 === 'string' && a0.startsWith('Vectors: Activated ')
            && Array.isArray(args[1]) && /\d+ WI entries$/.test(a0)) {
            for (const matched of args[1]) {
                if (typeof matched?.world === 'string' && Number.isFinite(Number(matched.uid))) {
                    vectorActivatedIds.add(makeDraftKey(matched.uid, matched.world));
                }
            }
            return;
        }

        if (typeof a0 === 'string' && /\[\s*WI\s*\]\s+WORLDINFO_FORCE_ACTIVATE\s+added entry/i.test(a0)) {
            const entryObj = args[1];
            const forceUid = Number(entryObj?.uid);
            if (entryObj && typeof entryObj === 'object' && Number.isFinite(forceUid)) {
                if (typeof entryObj.world === 'string' && entryObj.world.length) {
                    lastWorldByUid.set(forceUid, entryObj.world);
                }
                const d = upsertDraft(forceUid, entryObj.world);
                d.primary = null;
                d.secondary = [];
                d.secondaryNon = [];
                d.logic = 'FORCE_ACTIVATE';
            }
            return;
        }

        const uid = parseWiUIDFromFirstArg(a0);
        if (uid == null) return;

        const a1 = args[1];
        const a2 = args[2];

        // Normalize first arg as text (some WI logs are emitted as a single string line)
        const text0 = (typeof a0 === 'string') ? a0 : '';

        // Try to capture world name on "processing" lines: "[WI] Entry N from 'World' processing ..."
        let worldFromLine = null;
        try {
            const mW = text0.match(/\bfrom\s+'([^']+)'\s+processing/i);
            if (mW && mW[1]) worldFromLine = mW[1];
        } catch {}
        if (worldFromLine) {
            lastWorldByUid.set(uid, worldFromLine);
        }

        // Support single-line formats to capture primary/secondary/logic from a0
        try {
            // Primary key match inline:
            // e.g. "[WI] Entry 11 activated by primary key match kidnapped"
            const mPrimLine = text0.match(/\[WI\]\s+Entry\s+\d+.*?activated by primary key match\s+(.+)/i);
            if (mPrimLine && mPrimLine[1]) {
                const d = upsertDraft(uid, worldFromLine);
                d.primary = mPrimLine[1].trim();
            }

            // Also capture when the engine logs "Entry with primary key match X has secondary keywords"
            // This often appears one line after "processing" and before the "(AND ANY) activated" line.
            // Example: "Entry 21 Entry with primary key match custom has secondary keywords. Checking with logic logic (2) ['AND_ANY', 0]"
            const mPrimHasSecondary = text0.match(/\bEntry with primary key match\s+(.+?)\s+has secondary keywords/i);
            if (mPrimHasSecondary && mPrimHasSecondary[1]) {
                const d = upsertDraft(uid, worldFromLine);
                // Do not overwrite an already captured primary
                d.primary = d.primary || mPrimHasSecondary[1].trim();
            }

            // Capture logic indicator when printed in the "Checking with logic logic (N) ['AND_ANY', 0]" form
            const mLogicBracket = text0.match(/Checking with logic\s+logic\s*\(\d+\)\s*\[['"]?(AND_ANY|AND_ALL|NOT_ANY|NOT_ALL)['"]?/i);
            if (mLogicBracket && mLogicBracket[1]) {
                const d = upsertDraft(uid, worldFromLine);
                d.logic = d.logic ?? mLogicBracket[1]; // keep underscore variant; renderer maps to display text
            }

            // Secondary captures inline (AND ANY)
            const mSecAndAny = text0.match(/\(AND ANY\)\s*Found match secondary keyword\s+(.+)/i);
            if (mSecAndAny && mSecAndAny[1]) {
            const d = upsertDraft(uid, worldFromLine);
                d.secondary.push(mSecAndAny[1].trim());
                d.logic = d.logic ?? 'AND_ANY';
            }

            // Secondary captures inline (NOT ALL)
            const mSecNotAll = text0.match(/\(NOT ALL\)\s*Found not matching secondary keyword\s+(.+)/i);
            if (mSecNotAll && mSecNotAll[1]) {
            const d = upsertDraft(uid, worldFromLine);
                d.secondaryNon.push(mSecNotAll[1].trim());
                d.logic = d.logic ?? 'NOT_ALL';
            }

            // Secondary logic inline (NOT ANY)
            if (/\(NOT ANY\)\s*No secondary keywords found/i.test(text0)) {
            const d = upsertDraft(uid, worldFromLine);
                d.logic = 'NOT_ANY';
            }

            // Secondary logic inline (AND ALL)
            if (/\(AND ALL\)\s*All secondary keywords found/i.test(text0)) {
            const d = upsertDraft(uid, worldFromLine);
                d.logic = 'AND_ALL';
            }

            // Priority winner inline
            if (/activated as prio winner/i.test(text0)) {
            const d = upsertDraft(uid, worldFromLine);
                d.logic = d.logic ?? 'PRIO_WINNER';
            }

            // Constant inline
            if (/activated because of constant/i.test(text0)) {
            const d = upsertDraft(uid, worldFromLine);
                d.logic = d.logic ?? 'CONSTANT';
            }
        } catch {}

        // Other proven activation paths emitted by SillyTavern itself.
        if (a1 === 'activated because active sticky') {
            upsertDraft(uid).logic = 'STICKY';
            return;
        }
        if (a1 === 'activated by @@activate decorator') {
            upsertDraft(uid).logic = 'DECORATOR';
            return;
        }
        if (a1 === 'externally activated') {
            const d = upsertDraft(uid);
            d.logic = d.logic ?? 'EXTERNAL';
            return;
        }

        // Selective entries report the primary match as a separate console
        // argument, before their AND/NOT secondary result.
        if (a1 === 'Entry with primary key match' && typeof a2 === 'string') {
            const d = upsertDraft(uid);
            d.primary = a2;
            return;
        }

        // Primary matched
        if (a1 === 'activated by primary key match') {
            const d = upsertDraft(uid);
            if (typeof a2 === 'string') d.primary = a2;
            return;
        }

        // Secondary logic captures
        if (a1 === 'activated. (AND ANY) Found match secondary keyword') {
            const d = upsertDraft(uid);
            if (typeof a2 === 'string') d.secondary.push(a2);
            d.logic = d.logic ?? 'AND_ANY';
            return;
        }

        if (a1 === 'activated. (NOT ALL) Found not matching secondary keyword') {
            const d = upsertDraft(uid);
            if (typeof a2 === 'string') d.secondaryNon.push(a2);
            d.logic = d.logic ?? 'NOT_ALL';
            return;
        }

        if (a1 === 'activated. (NOT ANY) No secondary keywords found') {
            const d = upsertDraft(uid);
            d.logic = 'NOT_ANY';
            return;
        }

        if (a1 === 'activated. (AND ALL) All secondary keywords found') {
            const d = upsertDraft(uid);
            d.logic = 'AND_ALL';
            return;
        }

        // Priority winner (inclusion group) capture
        if (typeof a1 === 'string' && a1.startsWith('activated as prio winner')) {
            const d = upsertDraft(uid);
            d.logic = d.logic ?? 'PRIO_WINNER';
            return;
        }

        // Constant activation message (legacy/supportive)
        if (typeof a1 === 'string' && a1.startsWith('activated because of constant')) {
            const d = upsertDraft(uid);
            d.logic = d.logic ?? 'CONSTANT';
            return;
        }

        // Final activation commit
        if (typeof a0 === 'string' && a0.includes('activation successful, adding to prompt')) {
            const entryObj = args[1];
            if (!entryObj || typeof entryObj !== 'object') return;
            const compKey = makeDraftKey(entryObj.uid, entryObj.world);
            const placeholderKey = makeDraftKey(entryObj.uid, null);
            const d = activationDrafts.get(compKey) || activationDrafts.get(placeholderKey) || { primary: null, secondary: [], secondaryNon: [], logic: null };

            // Fallback: if AND_ALL but no captured secondaries, include all entry secondaries
            const sec = (d.logic === 'AND_ALL' && (!d.secondary || d.secondary.length === 0) && Array.isArray(entryObj.keysecondary))
                ? [...entryObj.keysecondary]
                : (d.secondary || []);

            const ev = {
                ts: Date.now(),
                world: entryObj.world,
                uid: entryObj.uid,
                comment: entryObj.comment ?? '',
                constant: entryObj.constant === true,
                vectorized: entryObj.vectorized === true,
                keys: Array.isArray(entryObj.key) ? [...entryObj.key] : [],
                primary: d.primary,
                secondary: sec,
                logic: d.logic,
                // Proven by the vector extension's own selected-entry log.
                vectorConfirmed: vectorActivatedIds.has(compKey),
                reason: (() => {
                    if (entryObj.constant === true) return 'constant';
                    if (d.logic === 'FORCE_ACTIVATE') return 'force_activate';
                    if (typeof d.primary === 'string' && d.primary.length) return 'primary';
                    if (['AND_ANY','AND_ALL','NOT_ANY','NOT_ALL'].includes(d.logic)) return 'secondary';
                    if (entryObj.vectorized === true) return 'vector';
                    if (d.logic === 'PRIO_WINNER') return 'prio_winner';
                    return 'other';
                })(),
            };

            ev.runId = (stwiiCurrentBuild && stwiiCurrentBuild.runId) ? stwiiCurrentBuild.runId : (window.STWII?.currentRunId ?? null);

            // Track per-loop event IDs if inside a loop
            if (Array.isArray(stwiiCurrentLoopEventIds) && stwiiActiveLoopIndex >= 0) {
                while (stwiiCurrentLoopEventIds.length <= stwiiActiveLoopIndex) stwiiCurrentLoopEventIds.push([]);
                stwiiCurrentLoopEventIds[stwiiActiveLoopIndex].push(`${entryObj.world}:${entryObj.uid}`);
            }

            // Track in current build session if present
            if (stwiiCurrentBuild) stwiiCurrentBuild.added.push(ev);

            activationDrafts.delete(compKey);
            activationDrafts.delete(placeholderKey);
            return;
        }
    }

    const worldInfoLogSources = [
        new URL('../../../world-info.js', import.meta.url).href,
        new URL('../../vectors/index.js', import.meta.url).href,
    ];

    function releaseWorldInfoConsoleCapture() {
        stopConsoleCapture?.();
        stopConsoleCapture = null;
    }

    function captureDebug(original_debug, ...args) {
        if (!realGenerationInProgress) return original_debug.apply(console, args);
        const firstArg = args[0];
        if (typeof firstArg !== 'string' || !(
            firstArg.includes('[WI]') || firstArg.includes('--- BUILDING PROMPT ---')
            || firstArg.includes('--- DONE ---') || firstArg.startsWith('Vectors: Activated ') || /^WI entry \d+ failed probability check, removing from activated entries$/.test(firstArg)
        )) return original_debug.apply(console, args);
        if (firstArg.includes('[WI] --- START WI SCAN')) stwiiDryRunActive = firstArg.includes('(DRY RUN)');
        if (stwiiDryRunActive) return original_debug.apply(console, args);
        // capture WI activation details
        try { handleWiDebugArgs(args); } catch {}

        // Track build session boundaries and capture counts (ignore DRY RUNs)
        try {
            const first = String(args[0] ?? '');
            const asText = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
            if (stwiiCurrentBuild && asText) pushBounded(stwiiCurrentBuild.logs, asText, STWII.MAX_BUILD_LOGS);

            // Start/end markers
            if (asText.includes('[WI] --- START WI SCAN')) startBuildSession(true);
            if (first.includes('--- BUILDING PROMPT ---') && !stwiiCurrentBuild) startBuildSession();
            if (first.includes('--- DONE ---')) endBuildSession();

            // Detect WI scan start to reset loop counts; track DRY RUNs
            if (asText.includes('[WI] --- START WI SCAN')) {
                stwiiDryRunActive = asText.includes('(DRY RUN)');
                const countMatch = asText.match(/START WI SCAN \(on (\d+) messages/);
                stwiiCurrentScanMessageCount = !stwiiDryRunActive && countMatch
                    ? Number(countMatch[1]) : null;
                stwiiCurrentLoopCounts = [];
                stwiiCurrentLoopEntryIds = [];
                stwiiCurrentLoopEventIds = [];
                stwiiActiveLoopIndex = -1;
            }

            // Capture per-loop counts (non-dry run only), and try to capture the array of entries printed by engine
            const mLoop = asText.match(/Successfully\s+activated\s+(\d+)\s+new\s+entries\s+to\s+prompt/i);
            if (mLoop && !stwiiDryRunActive && Array.isArray(stwiiCurrentLoopCounts)) {
                const n = Number(mLoop[1]);
                if (Number.isFinite(n)) {
                    stwiiCurrentLoopCounts.push(n);
                    if (Array.isArray(stwiiCurrentLoopEntryIds)) {
                        let ids = null;
                        try {
                            for (const arg of args) {
                                if (Array.isArray(arg) && arg.length === n && arg.every(o => o && typeof o === 'object' && ('uid' in o) && ('world' in o))) {
                                    ids = arg.map(o => `${o.world}:${o.uid}`);
                                    break;
                                }
                            }
                        } catch {}
                        stwiiCurrentLoopEntryIds.push(ids);
                    }
                }
            }

            // Capture final "Adding N entries to prompt" (ignore "Hypothetically")
            const mAdd = asText.match(/\[\s*WI\s*\]\s+Adding\s+(\d+)\s+entries\s+to\s+prompt\b/i);
            if (mAdd && !stwiiDryRunActive) {
                const n = Number(mAdd[1]);
                if (Number.isSafeInteger(n) && stwiiCurrentBuild) stwiiCurrentBuild.finalCount = n;
            }
        } catch {}

        // No UI changes here: zero-entry and dry-run debug logs are not definitive.
        return original_debug.apply(console, args);
    }

    function captureLog(original_log, ...args) {
        if (!realGenerationInProgress) return original_log.apply(console, args);
        const firstArg = args[0];
        if (typeof firstArg !== 'string' || !(
            firstArg.includes('[WI]') || firstArg.includes('--- BUILDING PROMPT ---')
            || firstArg.includes('--- DONE ---') || firstArg.startsWith('Vectors: Activated ') || /^WI entry \d+ failed probability check, removing from activated entries$/.test(firstArg)
        )) return original_log.apply(console, args);
        if (firstArg.includes('[WI] --- START WI SCAN')) stwiiDryRunActive = firstArg.includes('(DRY RUN)');
        if (stwiiDryRunActive) return original_log.apply(console, args);
        // capture WI activation details (just in case)
        try { handleWiDebugArgs(args); } catch {}

        // Track build session boundaries and capture counts (ignore DRY RUNs)
        try {
            const first = String(args[0] ?? '');
            const asText = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
            if (stwiiCurrentBuild && asText) pushBounded(stwiiCurrentBuild.logs, asText, STWII.MAX_BUILD_LOGS);

            // Start/end markers
            if (asText.includes('[WI] --- START WI SCAN')) startBuildSession(true);
            if (first.includes('--- BUILDING PROMPT ---') && !stwiiCurrentBuild) startBuildSession();
            if (first.includes('--- DONE ---')) endBuildSession();

            // Loop delimiters for per-loop collection
            const mLoopStart = asText.match(/\[WI\]\s+---\s+LOOP\s+#(\d+)\s+START\s+---/i);
            if (mLoopStart && Array.isArray(stwiiCurrentLoopEventIds)) {
                const idx = Number(mLoopStart[1]) - 1;
                if (Number.isFinite(idx) && idx >= 0) {
                    while (stwiiCurrentLoopEventIds.length <= idx) stwiiCurrentLoopEventIds.push([]);
                    stwiiActiveLoopIndex = idx;
                }
            }
            const mLoopResult = asText.match(/\[WI\]\s+---\s+LOOP\s+#(\d+)\s+RESULT\s+---/i);
            if (mLoopResult) {
                stwiiActiveLoopIndex = -1;
            }

            // Detect WI scan start to reset loop counts; track DRY RUNs
            if (asText.includes('[WI] --- START WI SCAN')) {
                stwiiDryRunActive = asText.includes('(DRY RUN)');
                const countMatch = asText.match(/START WI SCAN \(on (\d+) messages/);
                stwiiCurrentScanMessageCount = !stwiiDryRunActive && countMatch
                    ? Number(countMatch[1]) : null;
                stwiiCurrentLoopCounts = [];
                stwiiCurrentLoopEntryIds = [];
            }

            // Capture per-loop counts (non-dry run only), and try to capture the array of entries printed by engine
            const mLoop = asText.match(/Successfully\s+activated\s+(\d+)\s+new\s+entries\s+to\s+prompt/i);
            if (mLoop && !stwiiDryRunActive && Array.isArray(stwiiCurrentLoopCounts)) {
                const n = Number(mLoop[1]);
                if (Number.isFinite(n)) {
                    stwiiCurrentLoopCounts.push(n);
                    if (Array.isArray(stwiiCurrentLoopEntryIds)) {
                        let ids = null;
                        try {
                            for (const arg of args) {
                                if (Array.isArray(arg) && arg.length === n && arg.every(o => o && typeof o === 'object' && ('uid' in o) && ('world' in o))) {
                                    ids = arg.map(o => `${o.world}:${o.uid}`);
                                    break;
                                }
                            }
                        } catch {}
                        stwiiCurrentLoopEntryIds.push(ids);
                    }
                }
            }

            // Capture final "Adding N entries to prompt" (ignore "Hypothetically")
            const mAdd = asText.match(/\[\s*WI\s*\]\s+Adding\s+(\d+)\s+entries\s+to\s+prompt\b/i);
            if (mAdd && !stwiiDryRunActive) {
                const n = Number(mAdd[1]);
                if (Number.isSafeInteger(n) && stwiiCurrentBuild) stwiiCurrentBuild.finalCount = n;
            }
        } catch {}

        // No UI changes here: zero-entry and dry-run debug logs are not definitive.
        return original_log.apply(console, args);
    }

    function startWorldInfoConsoleCapture() {
        releaseWorldInfoConsoleCapture();
        // Exact activation reasons are only available in the engine's diagnostics.
        // Return the original function at every unrelated call site so DevTools
        // records the caller itself, rather than a forwarding wrapper.
        const restore = [];
        for (const [method, collect] of [['debug', captureDebug], ['log', captureLog]]) {
            const descriptor = Object.getOwnPropertyDescriptor(console, method);
            if (!descriptor?.configurable || !descriptor.writable || typeof descriptor.value !== 'function') continue;
            const capture = (...args) => collect(descriptor.value, ...args);
            const getWorldInfoConsoleMethod = function getWorldInfoConsoleMethod() {
                const frames = (new Error().stack ?? '').split('\n', 4);
                const callerIndex = frames.findIndex(frame => frame.includes('getWorldInfoConsoleMethod')) + 1;
                const caller = callerIndex > 0 ? frames[callerIndex] ?? '' : '';
                return worldInfoLogSources.some(source => caller.includes(source + ':') || caller.includes(source + '?'))
                    ? capture : descriptor.value;
            };
            Object.defineProperty(console, method, {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: getWorldInfoConsoleMethod,
                set(value) {
                    Object.defineProperty(console, method, { ...descriptor, value });
                },
            });
            restore.push(() => {
                if (Object.getOwnPropertyDescriptor(console, method)?.get === getWorldInfoConsoleMethod) {
                    Object.defineProperty(console, method, descriptor);
                }
            });
        }
        stopConsoleCapture = () => restore.forEach(release => release());
    }

// Optional teardown to remove UI and unpatch console
window.STWII.destroy = function() {
    insight.clear();
    insightTokens.clear();
    if (STWII.loreInsight === insight) delete STWII.loreInsight;
    if (STWII.loreTokenCountV1 === tokenBridge) delete STWII.loreTokenCountV1;
    tokenSummaryRequest++;
    tokenSummaryPending = -1;
    realGenerationInProgress = false;
    pendingEntries = [];
    lastLiveReport = null;
    lastReportBuild = null;
    stwiiCurrentBuild = null;
    badgeToken++;
    // New completion hooks have explicit teardown; no lingering token work.
    try {
        eventSource.removeListener?.(event_types.GENERATION_ENDED, onCompletedGeneration);
        eventSource.removeListener?.(event_types.MESSAGE_RECEIVED, onCompletedGeneration);
        eventSource.removeListener?.(event_types.GENERATION_STOPPED, onGenerationStopped);
        eventSource.removeListener?.(event_types.GENERATION_STARTED, beginRealGeneration);
        eventSource.removeListener?.(event_types.WORLDINFO_ENTRIES_LOADED, onWorldInfoEntriesLoaded);
        eventSource.removeListener?.(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.removeListener?.(event_types.WORLD_INFO_ACTIVATED, onWorldInfoActivated);
        eventSource.removeListener?.(event_types.GENERATE_AFTER_DATA, onGenerateAfterData);
    } catch {}
    if (STWII.recordStloJevRecall === recordStloJevRecall) delete STWII.recordStloJevRecall;
    jevRecall.reset();
    linkedLoreClickSerial++;
    closeLoreViewer();
    releaseWorldInfoConsoleCapture();
    releasePromptTrace();noteBeforeScan=null;
    try {
        const t = window.STWII.trigger;
        if (t && t.parentNode) t.parentNode.removeChild(t);
        const p = window.STWII.panel;
        if (p && p.parentNode) p.parentNode.removeChild(p);
        const c = window.STWII.configPanel;
        if (c && c.parentNode) c.parentNode.removeChild(c);
        window.removeEventListener('resize', schedulePositionRepair);
        window.removeEventListener('orientationchange', schedulePositionRepair);
        window.visualViewport?.removeEventListener?.('resize', schedulePositionRepair);
        window.visualViewport?.removeEventListener?.('scroll', schedulePositionRepair);
        if (positionRepairFrame !== null) cancelAnimationFrame(positionRepairFrame);
        STWII.repairPositions = null;
    } catch {}
    window.STWII.initialized = false;
};

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'wi-triggered',
        callback: (args, value)=>{
            return JSON.stringify(currentEntryList);
        },
        returns: wiT('command.triggered.returns'),
        helpString: wiT('command.triggered.help'),
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wi-position-reset',
        callback: () => {
            resetWiTriggerPosition();
            return wiT('command.reset.done');
        },
        returns: wiT('command.reset.returns'),
        helpString: wiT('command.reset.help'),
    }));

    // Generate a keyword frequency report from captured activation events (popup with declared options)
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'wi-report',
        returns: wiT('command.report.returns'),
        helpString: wiT('command.report.help'),
        callback: async () => {
            // Prefer the current RAM report even if its saved copy was capped.
            const compact = chat_metadata.stwiiLastReport;
            const freshMemory = lastLiveReport?.chatId === getCurrentChatId() ? lastLiveReport : null;
            const legacyBuild = Array.isArray(chat_metadata.stwiiBuilds) ? chat_metadata.stwiiBuilds.at(-1) : null;
            const lastBuild = freshMemory || compact || legacyBuild;
            let events = [];
            if (Array.isArray(lastBuild?.added)) {
                events = lastBuild.added;
            } else {
                const all = Array.isArray(chat_metadata.stwiiActivationEvents) ? chat_metadata.stwiiActivationEvents : [];
                const n = Number(chat_metadata.stwiiLastAddedCount);
                events = Number.isFinite(n) && n > 0 && all.length >= n ? all.slice(-n) : all;
            }

            // Hide events from hidden lorebooks for non-admins (same rules as panel)
            const adminBypass = isAdmin();

            // Panel-only per-user visibility for Z- lorebooks.
            // - Exempt "9Z Universal Commands" (visible to everyone)
            // - Z-<handle>-* is visible only to matching user (admins see all)
            // - Other 9Z remain hidden for non-admins
            const norm = (s) => (typeof s === 'string' ? s : '').trim();

            // Extract single handle after "Z-", e.g. "Z-alice-..." => "alice"
            // Allows "Z-alice" (no trailing dash) as well.
            const extractZHandle = (world) => {
                const m = norm(world).match(/^Z-([^-\s]+)(?:-|$)/);
                return m ? m[1] : null;
            };

            // Provided by the host app; fallback to empty if unavailable.
            const currentHandle = (typeof getCurrentUserHandle === 'function' ? getCurrentUserHandle() : '')
                .trim();

            const isHiddenWorld = (w)=> {
                const s = norm(w);
                if (s === '9Z Universal Commands') return false; // exemption

                // Per-user visibility for Z- lorebooks:
                const h = extractZHandle(s);
                if (h) {
                    // Hide if the embedded handle does not match the current user
                    return h !== currentHandle;
                }

                // Keep other 9Z hidden for non-admins
                return s.startsWith('9Z');
            };

            if (!adminBypass) {
                events = events.filter(ev => !isHiddenWorld(ev.world));
            }

            // Build keyword overrides from build logs (diagnostic parsing per loop)
            const logLines = Array.isArray(lastBuild?.logs) ? lastBuild.logs : [];
            const loopRanges = [];
            if (logLines.length) {
                for (let i = 0; i < logLines.length; i++) {
                    const mStart = (logLines[i] || '').match(/\[WI\]\s+---\s+LOOP\s+#(\d+)\s+START\s+---/i);
                    if (mStart) {
                        const n = Number(mStart[1]);
                        let j = i + 1;
                        for (; j < logLines.length; j++) {
                            const mEnd = (logLines[j] || '').match(/\[WI\]\s+---\s+LOOP\s+#(\d+)\s+RESULT\s+---/i);
                            if (mEnd) break;
                        }
                        loopRanges[n - 1] = [i, j];
                    }
                }
            }
            const idsByLoopDiag = Array.isArray(lastBuild?.loopEntryIds) ? lastBuild.loopEntryIds :
                (Array.isArray(chat_metadata.stwiiLastLoopEntryIds) ? chat_metadata.stwiiLastLoopEntryIds : null);
            const overrideById = new Map();
            if (idsByLoopDiag && idsByLoopDiag.length && loopRanges.length && logLines.length) {
                for (let i = 0; i < idsByLoopDiag.length; i++) {
                    const ids = idsByLoopDiag[i];
                    if (!Array.isArray(ids)) continue;
                    const range = loopRanges[i];
                    const start = Array.isArray(range) ? range[0] : 0;
                    const end = Array.isArray(range) ? range[1] : (logLines.length - 1);
                    for (const id of ids) {
                        const parts = String(id).split(':');
                        const uid = Number(parts.at(-1));
                        const worldName = parts.slice(0, -1).join(':') || null;
                        if (!Number.isFinite(uid)) continue;
                        let idx = -1;
                        for (let k = start; k <= end; k++) {
                            const ln = logLines[k] || '';
                            const matchesUid = ln.includes(`[WI] Entry ${uid} `) && ln.includes('processing');
                            const matchesWorld = worldName ? ln.includes(`from '${worldName}' processing`) : true;
                            if (matchesUid && matchesWorld) { idx = k; break; }
                        }
                        if (idx < 0) continue;
                        // Scan a short window after the processing line to robustly capture primary/logic/secondary
                        let prim = null, logic = null, sec = [];
                        for (let k2 = idx + 1; k2 <= Math.min(end, idx + 6); k2++) {
                            const lnN = logLines[k2] || '';
                            if (!prim) {
                                let m1 = lnN.match(/activated by primary key match\s+(.+)/i);
                                if (m1 && m1[1]) prim = m1[1].trim();
                                if (!prim) {
                                    const m2 = lnN.match(/Entry with primary key match\s+(.+?)\s+has secondary keywords/i);
                                    if (m2 && m2[1]) prim = m2[1].trim();
                                }
                            }
                            if (!logic) {
                                const m3 = lnN.match(/activated\.\s+\((AND ANY|AND ALL|NOT ANY|NOT ALL)\)\s*(?:Found (?:match|not matching) secondary keyword\s+(.+)|No secondary keywords found|All secondary keywords found)/i);
                                if (m3) {
                                    logic = m3[1].replace(/\s+/g, '_');
                                    if (m3[2]) sec.push(m3[2].trim());
                                }
                                // Also catch the "Checking with logic logic (N) ['AND_ANY', 0]" variant
                                const mLogicBracket2 = lnN.match(/Checking with logic\s+logic\s*\(\d+\)\s*\[['"]?(AND_ANY|AND_ALL|NOT_ANY|NOT_ALL)['"]?/i);
                                if (mLogicBracket2 && mLogicBracket2[1] && !logic) {
                                    logic = mLogicBracket2[1];
                                }
                            }
                        }
                        if (prim || sec.length || logic) {
                            overrideById.set(String(id), { primary: prim || null, logic: logic || null, secondary: sec });
                        }
                    }
                }
            }

            // Diagnostic fallback: parse primary/secondary by scanning all logs for the given UID
            function parseFromLogsByUid(lines, uid, world) {
                if (!Array.isArray(lines) || !Number.isFinite(uid)) return null;
                let lastIdx = -1;
                for (let i = 0; i < lines.length; i++) {
                    const t = lines[i] || '';
                    const matchesUid = t.includes(`[WI] Entry ${uid} `) && t.includes('processing');
                    const matchesWorld = world ? t.includes(`from '${world}' processing`) : true;
                    if (matchesUid && matchesWorld) {
                        lastIdx = i;
                    }
                }
                if (lastIdx < 0) return null;
                // Scan a small window after the processing line to extract details even if interleaved
                let prim = null, logic = null, sec = [];
                for (let k = lastIdx + 1; k <= Math.min(lines.length - 1, lastIdx + 6); k++) {
                    const lnN = lines[k] || '';
                    if (!prim) {
                        let m1 = lnN.match(/activated by primary key match\s+(.+)/i);
                        if (m1 && m1[1]) prim = m1[1].trim();
                        if (!prim) {
                            const m2 = lnN.match(/Entry with primary key match\s+(.+?)\s+has secondary keywords/i);
                            if (m2 && m2[1]) prim = m2[1].trim();
                        }
                    }
                    if (!logic) {
                        const m3 = lnN.match(/activated\.\s+\((AND ANY|AND ALL|NOT ANY|NOT ALL)\)\s*(?:Found (?:match|not matching) secondary keyword\s+(.+)|No secondary keywords found|All secondary keywords found)/i);
                        if (m3) {
                            logic = m3[1].replace(/\s+/g, '_');
                            if (m3[2]) sec.push(m3[2].trim());
                        }
                        // Also catch logic-only bracket line
                        const mLogicBracket2 = lnN.match(/Checking with logic\s+logic\s*\(\d+\)\s*\[['"]?(AND_ANY|AND_ALL|NOT_ANY|NOT_ALL)['"]?/i);
                        if (mLogicBracket2 && mLogicBracket2[1] && !logic) {
                            logic = mLogicBracket2[1];
                        }
                    }
                }
                if (prim || sec.length || logic) return { primary: prim || null, logic: logic || null, secondary: sec };
                return null;
            }

            // Build frequency map: keyword -> { count, entries: Set<string> }
            const freq = new Map();
            const sanitizeComment = (s) => typeof s === 'string'
                ? s.trim().replace(/-\s*S[0-9][0-9A-Za-z.\-]*$/, '').trim()
                : '';
            const fmtEntry = (e) => {
                const c = sanitizeComment(displayWiTitle({ ...e, key: e.keys }));
                return `${e.world}:${e.uid}${c ? ` - ${c}` : ''}`;
            };
            const FORCE_ACTIVATED_KEYWORD = '(force activated)';
            const isForceActivatedEvent = (ev, primaryKw = null, secondaryKws = []) => {
                if (!ev || ev.constant === true) return false;
                if (ev.logic === 'FORCE_ACTIVATE' || ev.reason === 'force_activate') return true;
                const hasPrimary = typeof primaryKw === 'string' && primaryKw.length > 0;
                const hasSecondary = Array.isArray(secondaryKws) && secondaryKws.filter(Boolean).length > 0;
                return ev.reason === 'vector' && !hasPrimary && !hasSecondary;
            };

            // Track entries that had explicit keywords and those that were primary-only
            const entriesWithKeywords = new Set();
            const primaryOnlyEntries = new Set();

            if (events.length) {
                for (const ev of events) {
                    // Jev is a recall source, not a matched keyword.
                    if (ev.jevConfirmed === true) continue;
                    const entryIdent = fmtEntry(ev);
                    const ov = overrideById.get(`${ev.world}:${ev.uid}`) || parseFromLogsByUid(logLines, ev.uid, ev.world) || null;
                    const primaryUse = ov && ov.primary ? ov.primary : (ev.primary || null);
                    const secondaryUse = ov && Array.isArray(ov.secondary) ? ov.secondary : (Array.isArray(ev.secondary) ? ev.secondary : []);
                    const kws = isForceActivatedEvent(ev, primaryUse, secondaryUse)
                        ? [FORCE_ACTIVATED_KEYWORD]
                        : []
                            .concat(primaryUse ? [primaryUse] : [])
                            .concat(secondaryUse);

                    if (kws.length > 0) {
                        entriesWithKeywords.add(entryIdent);
                    } else if (ev.constant !== true) {
                        primaryOnlyEntries.add(entryIdent);
                        // Ensure at least placeholder contributes if somehow missing and not a constant activation
                        kws.push('(no keyword)');
                    }

                    for (const kw of kws) {
                        if (!freq.has(kw)) freq.set(kw, { count: 0, entries: new Set() });
                        const rec = freq.get(kw);
                        rec.count += 1;
                        rec.entries.add(entryIdent);
                    }
                }
            }

            // Remove from "(no keyword)" any entries that also appeared with explicit keywords, and align its count
            if (freq.has('(no keyword)')) {
                const p = freq.get('(no keyword)');
                const filtered = new Set([...p.entries].filter(e => !entriesWithKeywords.has(e)));
                p.entries = filtered;
                p.count = filtered.size;
            }

            const sorted = [...freq.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));

            // Build popup content with classes (no inline styles)
            const container = document.createElement('div');
            container.classList.add('stwii-report-container');

            const title = document.createElement('div');
            title.classList.add('stwii-report-title');
            title.textContent = wiT('report.title');
            container.append(title);

            const summary = document.createElement('div');
            summary.classList.add('stwii-report-summary');
            const addedCount = events.length;
            summary.textContent = events.length
                ? wiT('report.summary', addedCount, sorted.length)
                : wiT('report.empty');
            container.append(summary);
            if (lastBuild?.truncated || lastBuild?.incomplete) {
                const notice = document.createElement('div');
                notice.classList.add('stwii-report-summary');
                notice.textContent = wiT(lastBuild.incomplete ? 'report.incomplete' : 'report.truncated');
                container.append(notice);
            }

            // Loop breakdown (from latest non-dry run)
            // Show counts after applying hidden-book filtering
            const loops = Array.isArray(lastBuild?.loopCounts) ? lastBuild.loopCounts :
                    (Array.isArray(chat_metadata.stwiiLastLoopCounts) ? chat_metadata.stwiiLastLoopCounts : []);
            if (loops.length > 0) {
                const loopDiv = document.createElement('div');
                loopDiv.classList.add('stwii-report-summary');

                const idsByLoop = Array.isArray(lastBuild?.loopEntryIds) ? lastBuild.loopEntryIds :
                        (Array.isArray(chat_metadata.stwiiLastLoopEntryIds) ? chat_metadata.stwiiLastLoopEntryIds : null);
                const validIds = new Set(events.map(ev => `${ev.world}:${ev.uid}`));

                const pieces = loops.map((n, i) => {
                    let shown = Number.isFinite(n) ? n : 0;

                    if (idsByLoop && Array.isArray(idsByLoop[i])) {
                        // Use precise ID mapping when available, then filter by visible events
                        shown = idsByLoop[i].filter(id => validIds.has(id)).length;
                    } else {
                        // Fallback approximation: slice by original loop sizes but count only visible events in that range
                        const start = loops.slice(0, i).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
                        const end = start + (Number.isFinite(n) ? n : 0);
                        shown = events.slice(start, end).length;
                    }

                    return wiT('report.loopSummary', i + 1, shown);
                });

                loopDiv.textContent = pieces.join(' • ');
                container.append(loopDiv);
            }

            if (events.length && sorted.length) {
                const freqHeader = document.createElement('div');
                freqHeader.classList.add('stwii-report-subtitle');
                freqHeader.textContent = wiT('report.frequency');
                container.append(freqHeader);

                const table = document.createElement('table');
                table.classList.add('stwii-report-table');

                const thead = document.createElement('thead');
                const headRow = document.createElement('tr');
                for (const labelKey of ['report.keyword', 'report.hits', 'report.entries']) {
                    const th = document.createElement('th');
                    if (labelKey === 'report.hits') th.classList.add('stwii-report-table-count');
                    th.textContent = wiT(labelKey);
                    headRow.append(th);
                }
                thead.append(headRow);
                table.append(thead);

                const tbody = document.createElement('tbody');
                for (const [kw, rec] of sorted) {
                    const row = document.createElement('tr');

                    const keywordCell = document.createElement('td');
                    keywordCell.textContent = kw === '(no keyword)' ? wiT('report.noKeyword')
                        : kw === FORCE_ACTIVATED_KEYWORD ? wiT('report.forceActivated') : kw;
                    row.append(keywordCell);

                    const hitsCell = document.createElement('td');
                    hitsCell.classList.add('stwii-report-table-count');
                    hitsCell.textContent = String(rec.count);
                    row.append(hitsCell);

                    const entriesCell = document.createElement('td');
                    const entries = [...rec.entries].sort((a, b) => a.localeCompare(b));
                    const details = document.createElement('details');
                    details.classList.add('stwii-report-drawer');

                    const detailsSummary = document.createElement('summary');
                    detailsSummary.textContent = wiT('report.entryCount', entries.length);
                    details.append(detailsSummary);

                    const entryList = document.createElement('ul');
                    for (const entry of entries) {
                        const li = document.createElement('li');
                        li.textContent = entry;
                        entryList.append(li);
                    }
                    details.append(entryList);
                    entriesCell.append(details);
                    row.append(entriesCell);

                    tbody.append(row);
                }
                table.append(tbody);
                container.append(table);
            }

            // Per-loop sections (list entries by loop using last non-dry-run loop counts)
            (function renderLoops() {
                const loops = Array.isArray(lastBuild?.loopCounts) ? lastBuild.loopCounts :
                    (Array.isArray(chat_metadata.stwiiLastLoopCounts) ? chat_metadata.stwiiLastLoopCounts : []);
                if (!Array.isArray(loops) || loops.length === 0) return;

                const total = loops.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
                if (!Number.isFinite(total) || total <= 0) return;

                let offset = 0;
                for (let i = 0; i < loops.length; i++) {
                    const cnt = Number(loops[i]);
                    if (!Number.isFinite(cnt) || cnt <= 0) continue;

                    const header = document.createElement('div');
                    header.classList.add('stwii-report-subtitle');
                    header.textContent = wiT('report.loopTitle', i + 1);
                    container.append(header);

                    let list = [];
                    const idsByLoop = Array.isArray(lastBuild?.loopEntryIds) ? lastBuild.loopEntryIds :
                        (Array.isArray(chat_metadata.stwiiLastLoopEntryIds) ? chat_metadata.stwiiLastLoopEntryIds : null);
                    if (idsByLoop && Array.isArray(idsByLoop[i]) && idsByLoop[i]?.length === cnt) {
                        const byId = new Map(events.map(ev => [`${ev.world}:${ev.uid}`, ev]));
                        list = idsByLoop[i].map(id => byId.get(id)).filter(Boolean);
                    } else {
                        const start = offset;
                        const end = Math.min(events.length, start + (Number.isFinite(cnt) ? cnt : 0));
                        list = start < end ? events.slice(start, end) : [];
                    }

                    const ul = document.createElement('ul');
                    for (const ev of list) {
                        const li = document.createElement('li');
                        li.textContent = fmtEntry(ev);
                        if (ev.jevConfirmed === true) {
                            li.textContent += ' · 🔮 ' + wiT('reader.reason.jev');
                            ul.append(li);
                            continue;
                        }

                        // Highlight constants
                        if (ev && ev.constant === true) {
                            li.style.color = 'var(--SmartThemeEmColor)';
                        }

                        // Append matched keywords inline with operation between primary and secondary
                        // Skip keyword suffix for constant entries
                        if (!(ev && ev.constant === true)) {
                            // Examples:
                            //  - "king AND ANY rainbow"
                            //  - "running NOT ANY circle"
                        const ov2 = overrideById.get(`${ev.world}:${ev.uid}`) || parseFromLogsByUid(logLines, ev.uid, ev.world) || null;
                        const primaryKw = ov2 && ov2.primary ? ov2.primary : (ev && ev.primary ? ev.primary : null);
                        const secRaw = ov2 && Array.isArray(ov2.secondary) ? ov2.secondary.filter(Boolean) : (ev && Array.isArray(ev.secondary) ? ev.secondary.filter(Boolean) : []);
                        const uniqSec = Array.from(new Set(secRaw));
                        const logicMap = {
                            AND_ANY: 'AND ANY',
                            AND_ALL: 'AND ALL',
                            NOT_ANY: 'NOT ANY',
                            NOT_ALL: 'NOT ALL',
                        };
                        const op = ov2 && ov2.logic ? logicMap[ov2.logic] ?? null : (ev && ev.logic ? logicMap[ev.logic] ?? null : null);

                        const prim = primaryKw;
                        // Deduplicate if primary also appears among secondaries (case-insensitive)
                        const uniqSecFiltered = prim ? uniqSec.filter(s => String(s).toLowerCase() !== String(prim).toLowerCase()) : uniqSec;

                        let kwText = '';
                        if (isForceActivatedEvent(ev, primaryKw, secRaw)) {
                            kwText = ' ' + wiT('report.forceActivated');
                        } else if (prim && uniqSecFiltered.length) {
                            // Have primary and secondaries; include op if present, otherwise comma-separate
                            if (op) {
                                kwText = ` (${prim} ${op} ${uniqSecFiltered.join(', ')})`;
                            } else {
                                kwText = ` (${prim}, ${uniqSecFiltered.join(', ')})`;
                            }
                        } else if (prim) {
                            // Primary only
                            kwText = ` (${prim})`;
                        } else if (uniqSecFiltered.length) {
                            // Secondary-only; include op if present
                            if (op) {
                                kwText = ` (${op} ${uniqSecFiltered.join(', ')})`;
                            } else {
                                kwText = ` (${uniqSecFiltered.join(', ')})`;
                            }
                        } else {
                            // No captured primary or secondary keywords
                            kwText = ' ' + wiT('report.noKeyword');
                        }

                            if (kwText) {
                                const span = document.createElement('span');
                                span.style.color = 'var(--SmartThemeQuoteColor)';
                                span.textContent = kwText;
                                li.append(span);
                            }
                        }

                        ul.append(li);
                    }
                    container.append(ul);

                    // paragraph break between loops
                    const spacer = document.createElement('div');
                    spacer.classList.add('stwii-report-summary');
                    spacer.textContent = '';
                    container.append(spacer);

                    offset += cnt;
                }
            })();

            // Use Popup API with allowVerticalScrolling
            const popup = new Popup(container, POPUP_TYPE.TEXT, '', {
                allowVerticalScrolling: true,
                okButton: wiT('reader.close'),
                wide: true,
                large: true,
                leftAlign: true,
                animation: 'fast',
            });
            await popup.show();
            return wiT('command.report.done');
        },
    }));
};
init();
