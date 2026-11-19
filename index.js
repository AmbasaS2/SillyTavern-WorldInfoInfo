import { chat, chat_metadata, event_types, eventSource, main_api, saveSettingsDebounced, getCurrentChatId } from '../../../../script.js';
import { translate as stTranslate } from '../../../i18n.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { delay, flashHighlight } from '../../../utils.js';
import { world_info_position, world_names, loadWorldInfo, openWorldInfoEditor } from '../../../world-info.js';
import { getRegexedString, regex_placement } from '../../regex/engine.js';
import { isAdmin, getCurrentUserHandle } from '../../../user.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { showdown, DOMPurify } from '../../../../lib.js';


// Localize only extension-authored UI. Lorebook text and stored translations are untouched.
const WI_UI_EN = {
    "trigger.tooltip": "Injected lore entries\nTap: show list · Long press / right click: settings",
    "settings.group.label": "Group by lorebook",
    "settings.group.hint": "Group injected entries by their lorebook.",
    "settings.order.label": "Show in injection order",
    "settings.order.hint": "Sort by insertion position and order rather than by title.",
    "settings.messages.label": "Show chat message positions",
    "settings.messages.hint": "Show the chat messages between injected lore entries when grouping is off and injection order is on.",
    "settings.drag.label": "Allow dragging the book button",
    "settings.drag.hint": "Allow the book button to be moved to another location.",
    "settings.reset.label": "Reset book button position",
    "settings.reset.hint": "Move the book button back to its default position.",
    "panel.none": "No injected lore entries",
    "panel.waiting": "No lore entries to show yet",
    "panel.hidden": "(hidden entries)",
    "panel.ungrouped": "Lore entries",
    "entry.note": "Author’s Note",
    "entry.sticky": "Sticky for {0} more rounds",
    "entry.message.one": "Message #{0}",
    "entry.message.range": "Messages #{0}–{1}",
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
    "reader.reason.sticky": "Sticky continuation",
    "reader.reason.external": "External activation",
    "reader.reason.decorator": "@@activate directive",
    "reader.reason.secondary": "Secondary condition",
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
    "report.loopSummary": "Loop {0}: {1} entries",
    "report.loopTitle": "Loop {0}",
    "report.frequency": "Keyword frequency",
    "report.keyword": "Keyword",
    "report.hits": "Occurrences",
    "report.entries": "Entries",
    "report.entryCount": "{0} entries",
    "report.noKeyword": "(no recorded keyword)",
    "report.forceActivated": "(force activated)"
};
function wiT(key, ...values) {
    const source = WI_UI_EN[key] ?? key;
    const translated = stTranslate(source, 'worldInfoInfo.' + key) || source;
    return String(translated).replace(/\{(\d+)\}/g, (match, index) =>
        values[Number(index)] === undefined ? match : String(values[Number(index)]));
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
        toastr.warning(error.message);
    } finally {
        navigatingEntry = false;
    }
}
STWII.MAX_ACTIVATION_EVENTS = STWII.MAX_ACTIVATION_EVENTS ?? 1000;
STWII.MAX_BUILDS = STWII.MAX_BUILDS ?? 5;
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
function trimBuilds() {
    try {
        const builds = chat_metadata.stwiiBuilds;
        if (!Array.isArray(builds)) return;
        while (builds.length > STWII.MAX_BUILDS) {
            const removed = builds.shift();
            if (removed && removed.runId != null && Array.isArray(chat_metadata.stwiiActivationEvents)) {
                chat_metadata.stwiiActivationEvents = chat_metadata.stwiiActivationEvents.filter(e => e?.runId !== removed.runId);
            }
        }
    } catch {}
}

const strategy = {
    constant: '🔵',
    normal: '🟢',
    vectorized: '🔗',
};
const getStrategy = (entry)=>{
    if (entry.constant === true) {
        return 'constant';
    } else if (entry.vectorized === true) {
        return 'vectorized';
    } else {
        return 'normal';
    }
};


// 2026-11-18 fork: display-only compatibility with Lorebook Manager; no writes to its data.
function displayWiTitle(entry) {
    const source = String(entry?.comment ?? '');
    const original = source.trim() || (Array.isArray(entry?.key) ? entry.key : entry?.keys ?? []).join(', ');
    const settings = extension_settings['simple-lorebook'];
    const id = String(entry?.world ?? '') + '\u241f' + String(entry?.uid ?? '');
    const record = settings?.translations?.[id];
    const language = settings?.entryLanguagePairs?.[id]?.translationLanguage;
    const title = record?.fields?.comment;
    if (record?.language !== 'Korean' || (language && language !== 'Korean') || title?.source !== source) return original;
    return typeof title?.text === 'string' && title.text.trim() ? title.text.trim() : original;
}


// Read-only body preview: the manager stores a hash of the original body.
function loreBodyHash(source) {
    const value=String(source ?? '');
    let hash=2166136261;
    for (let i=0; i<value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36) + '_' + value.length;
}
function displayWiBody(entry) {
    const source=String(entry?.content ?? '');
    const settings=extension_settings['simple-lorebook'];
    const id=String(entry?.world ?? '') + '\u241f' + String(entry?.uid ?? '');
    const record=settings?.translations?.[id];
    const language=settings?.entryLanguagePairs?.[id]?.translationLanguage;
    const usable=record?.language==='Korean' && (!language || language==='Korean')
        && record.sourceHash===loreBodyHash(source);
    return usable && typeof record.text==='string' && record.text.trim()
        ? record.text : source;
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
function renderLorePreview(target, source) {
    const content = String(source ?? '');
    try {
        target.innerHTML = DOMPurify.sanitize(wiLoreMarkdown.makeHtml(content), {
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


// Explain the most recent confirmed activation using the already-captured
// compact /wi-report event. Do not rescan lore, query vectors, or parse logs
// when the reader opens. A missing event is not evidence of vector activation.
function describeLoreActivation(entry) {
    const configured = wiT('reader.mode.' + getStrategy(entry));
    const events = chat_metadata.stwiiLastReport?.added;
    const ev = Array.isArray(events) ? events.find(item =>
        item?.world === entry?.world && Number(item.uid) === Number(entry?.uid)) : null;
    const causes = [];
    if (ev) {
        const logic = String(ev.logic || '');
        const primary = typeof ev.primary === 'string' ? ev.primary.trim() : '';
        const secondary = Array.isArray(ev.secondary) ? ev.secondary.filter(x => typeof x === 'string' && x.trim()) : [];
        const hasKeywordEvidence = primary || ['AND_ANY', 'AND_ALL', 'NOT_ANY', 'NOT_ALL'].includes(logic);
        if (hasKeywordEvidence) {
            let cause = wiT('reader.reason.keyword');
            if (primary) cause += ': ' + primary;
            if (secondary.length) cause += ' · ' + wiT('reader.reason.secondary') + ': ' + secondary.join(', ');
            else if (logic === 'NOT_ANY' || logic === 'NOT_ALL') cause += ' · ' + logic.replace('_', ' ');
            causes.push(cause);
        }
        if (ev.vectorConfirmed === true) causes.push(wiT('reader.reason.vector'));
        if (logic === 'CONSTANT') causes.push(wiT('reader.reason.constant'));
        if (logic === 'STICKY') causes.push(wiT('reader.reason.sticky'));
        if (logic === 'DECORATOR') causes.push(wiT('reader.reason.decorator'));
        if ((logic === 'FORCE_ACTIVATE' || logic === 'EXTERNAL') && ev.vectorConfirmed !== true) {
            causes.push(wiT('reader.reason.external'));
        }
    }
    return wiT('reader.mode.label') + ': ' + configured
        + ' · ' + wiT('reader.reason.label') + ': '
        + (causes.length ? causes.join(' + ') : wiT('reader.reason.unknown'));
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
        const data=await loadWorldInfo(entry.world);
        if (currentLoreViewer?.overlay!==overlay) return;
        const current=data?.entries?.[Number(entry.uid)];
        const full=current ? {...current,world:entry.world,uid:entry.uid} : entry;
        title.textContent=displayWiTitle(full);
        schedulePlaceViewer();
        const source=String(full?.content ?? '');
        const managerText=displayWiBody(full);
        renderLorePreview(body,managerText);
        // Prefer an existing, current Lorebook Manager translation. RT supplies
        // the body only when the manager has no usable translated body.
        if (managerText === source) {
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
function renderedWiContent(entry) {
    if (!entry?.content || entry.disable === true) return '';
    if (entry.position === world_info_position.outlet && !entry.outletName) return '';
    try {
        const depth = entry.position === world_info_position.atDepth ? (entry.depth ?? 4) : null;
        const text = getRegexedString(entry.content, regex_placement.WORLD_INFO, {
            depth, isMarkdown: false, isPrompt: true,
        });
        return typeof text === 'string' ? text.trim() : '';
    } catch (error) {
        console.warn('[WorldInfo Info] Unable to verify entry content', error);
        return '';
    }
}
function confirmedWiEntries(entryList, generationData) {
    const parts = promptTextParts(generationData?.prompt ?? generationData?.input);
    const finalPrompt = parts.join('\n').replace(/\s+/g, ' ').trim();

    return entryList.filter(entry => {
        // SillyTavern has already applied probability, budget, group and activation rules
        // before WORLD_INFO_ACTIVATED. Do not turn an unprovable string comparison into
        // 'No active entries' for ordinary (non-outlet) entries.
        const rendered = renderedWiContent(entry);
        if (!rendered) return false;
        if (entry.position !== world_info_position.outlet) return true;

        // Outlet entries are activated by the scan even when no outlet is consumed
        // by the preset. Only include one if its text actually reaches the request.
        if (!finalPrompt) return false;
        const candidates = [rendered, String(entry.content ?? '')];
        return candidates.some(text => {
            const normalized = text.replace(/\s+/g, ' ').trim();
            return normalized.length > 0 && finalPrompt.includes(normalized);
        });
    });
}

let generationType;
eventSource.on(event_types.GENERATION_STARTED, (genType)=>generationType = genType);

const init = ()=>{
    if (window.STWII?.initialized) return;
    STWII.initialized = true;
    // Preserve legacy chat metadata without adding further raw logs.
    const trigger = document.createElement('div'); {
        trigger.classList.add('stwii--trigger');
        trigger.classList.add('fa-solid', 'fa-fw', 'fa-book-atlas');
        trigger.title = wiT('trigger.tooltip');
        trigger.addEventListener('click', ()=>{
            // Entries are already rendered when the real generation is processed.
            // Opening the book should be an immediate visibility toggle, not a
            // second pass through chat history and every World Info entry.
            panel.classList.toggle('stwii--isActive');
            requestAnimationFrame(ensurePanelsVisible);
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
        // Reset position row
        const resetRow = document.createElement('div'); {
            resetRow.classList.add('stwii--configRow');
            resetRow.title = wiT('settings.reset.hint');
            resetRow.style.userSelect = 'none';
            const resetLbl = document.createElement('div'); {
                resetLbl.textContent = wiT('settings.reset.label');
                resetRow.append(resetLbl);
            }
            resetRow.addEventListener('click', ()=>{
                resetWiTriggerPosition(trigger);
            });
            configPanel.append(resetRow);
        }
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

        // Align the panel's center with the icon, rather than placing it a
        // whole panel-height above the icon. Clamp for small viewports.
        const y = clamp(tr.top + (tr.height - ph) / 2,
            bounds.top + margin, bounds.bottom - ph - margin);

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
            // A long press opens settings rather than also toggling the entry list.
            configPanel.classList.add('stwii--isActive');
            requestAnimationFrame(ensurePanelsVisible);
            setTimeout(() => { suppressNextClick = false; }, 850);
        }, 550);
    }
    function onLongPressPointerMove(e) {
        if (e.pointerId !== longPressPointerId) return;
        if (Math.abs(e.clientX - longPressStartX) > 10 ||
            Math.abs(e.clientY - longPressStartY) > 10) clearLongPress();
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
        if (!movedEnough && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) movedEnough = true;

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
        const changedEntries = new Set(newEntries).difference(new Set(entries)).size > 0;
        count = newEntries.length;
        entries = [...newEntries];
        trigger.classList.remove('stwii--badge-in', 'stwii--badge-out', 'stwii--badge-bounce');
        if (oldCount !== count) {
            if (count === 0) {
                if (oldCount < 0) {
                    trigger.setAttribute('data-stwii--badge-count', '0');
                    return;
                }
                trigger.classList.add('stwii--badge-out');
                await delay(510);
                if (token !== badgeToken) return;
                trigger.setAttribute('data-stwii--badge-count', '0');
                trigger.classList.remove('stwii--badge-out');
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
    let pendingEntries = [];
    let generationSerial = 0;
    let realGenerationInProgress = false;
    let lastReportBuild = null;
    let lastRenderedGenerationEntries = null;
    // Build the list as soon as ordinary lore activates, just like the
    // original extension. Delay only outlet entries until prompt verification.
    function renderGenerationEntries(list) {
        const signature = generationSerial + ':' + list.map(entry =>
            String(entry.world) + '§§§' + String(entry.uid) + '§§§' + String(entry.sticky || 0)).join('|');
        currentEntryList = [...list];
        if (signature === lastRenderedGenerationEntries) return;
        lastRenderedGenerationEntries = signature;
        void updateBadge(list.map(entry => String(entry.world) + '§§§' + String(entry.uid)));
        if (list.length) updatePanel(list, true);
        else panel.textContent = '?';
    }

    const beginRealGeneration = (type, options, dryRun) => {
        // Token-count passes and background/quiet generations aren't the
        // on-screen reply. Neither should replace the most recent displayed
        // reply's World Info. A quietToLoud generation *is* user-visible.
        if (dryRun || (type === 'quiet' && !options?.quietToLoud)) return;
        generationSerial++;
        realGenerationInProgress = true;
        pendingEntries = [];
        lastReportBuild = null;
        stwiiCurrentBuild = null;
        activationDrafts.clear();
        vectorActivatedIds.clear();
        lastWorldByUid.clear();
        stwiiCurrentLoopCounts = null;
        stwiiCurrentLoopEntryIds = null;
        stwiiCurrentLoopEventIds = null;
        stwiiActiveLoopIndex = -1;
        // Keep the previous completed result visible until this real run
        // resolves. Do not show an empty list mid-generation.
    };

    eventSource.on(event_types.GENERATION_STARTED, beginRealGeneration);
    eventSource.on(event_types.CHAT_CHANGED, () => {
        generationSerial++;
        realGenerationInProgress = false;
        pendingEntries = [];
        currentEntryList = [];
        lastRenderedGenerationEntries = null;
        lastReportBuild = null;
        stwiiCurrentBuild = null;
        activationDrafts.clear();
        vectorActivatedIds.clear();
        lastWorldByUid.clear();
        stwiiCurrentLoopCounts = null;
        stwiiCurrentLoopEntryIds = null;
        stwiiCurrentLoopEventIds = null;
        stwiiActiveLoopIndex = -1;
        panel.textContent = '?';
        void updateBadge([]);
    });

    // Activation events describe scan candidates, not actual final prompt insertion.
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async(entryList) => {
        if (!realGenerationInProgress) return;
        const serial = generationSerial;
        const filtered = entryList.filter(e => e?.disable !== true)
            .map(entry => ({ ...entry, type: 'wi', sticky: 0 }));
        pendingEntries = filtered;

        // This event arrives before GENERATE_AFTER_DATA. Pre-render only
        // ordinary, nonempty entries; a triggered outlet is NOT proof that
        // its named outlet was used in the final request.
        const immediatelyVisible = filtered.filter(entry =>
            entry.position !== world_info_position.outlet && !!renderedWiContent(entry));
        if (serial === generationSerial) renderGenerationEntries(immediatelyVisible);

        // Optional sticky metadata may take time. Do not make the list wait for it.
        for (const entry of filtered) {
            try {
                entry.sticky = parseInt(/**@type {string}*/(await SlashCommandParser.commands['wi-get-timed-effect'].callback(
                    {
                        effect: 'sticky', format: 'number', file: String(entry.world),
                        _scope: null, _abortController: null,
                    }, entry.uid,
                ))) || 0;
            } catch {
                entry.sticky = 0;
            }
            if (serial !== generationSerial) return;
        }
    });

    eventSource.on(event_types.GENERATE_AFTER_DATA, (data, dryRun) => {
        // Ignore dry runs and repeated/later hooks for an already completed run.
        if (dryRun || !realGenerationInProgress) return;
        realGenerationInProgress = false;
        const included = confirmedWiEntries(pendingEntries, data);
        pendingEntries = [];
        // Repaint only if an outlet is confirmed or sticky metadata changed;
        // otherwise keep the already-built DOM and instant button response.
        renderGenerationEntries(included);

        // Persist one compact report; never persist the intercepted console logs.
        const ids = new Set(included.map(it => String(it.world) + ':' + String(it.uid)));
        const build = lastReportBuild?.chatId === getCurrentChatId() ? lastReportBuild : null;
        if (build) build.added = build.added.filter(ev => ids.has(String(ev.world) + ':' + String(ev.uid)));
        chat_metadata.stwiiLastReport = {
            runId: build?.runId ?? Date.now(),
            added: build?.added ?? [],
            loopCounts: Array.isArray(stwiiCurrentLoopCounts) ? [...stwiiCurrentLoopCounts] : [],
            loopEntryIds: stwiiCurrentLoopCounts?.length && Array.isArray(chat_metadata.stwiiLastLoopEntryIds)
                ? chat_metadata.stwiiLastLoopEntryIds.map(ids => Array.isArray(ids) ? [...ids] : null) : [],
        };
    });

    const updatePanel = (entryList, newChat = false)=>{
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
                e.depth = e.position == world_info_position.atDepth ? e.depth : (chat_metadata[metadata_keys.depth] + (e.position == world_info_position.ANTop ? 0.1 : 0));
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
                    const an = chat_metadata[metadata_keys.prompt];
                    const ad = chat_metadata[metadata_keys.depth];
                    if (an?.length) {
                        const idx = entries.findIndex(e=>depthPos.includes(e.position) && e.depth <= ad);
                        entries.splice(idx, 0, {
                            type: 'note',
                            position: world_info_position.ANBottom,
                            depth: ad,
                            text: an,
                        });
                    }
                    if (newChat) {
                        currentChat = [...chat];
                        if (generationType == 'swipe') currentChat.pop();
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
                            e.addEventListener('click', () => showLoreViewer(entry));
                            e.addEventListener('keydown', (event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                showLoreViewer(entry);
                            });
                        }
                        const wipEx = [world_info_position.EMTop, world_info_position.EMBottom];
                        e.title = '';
                        if (entry.type == 'mes') e.classList.add('stwii--messages');
                        if (entry.type == 'note') e.classList.add('stwii--note');
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            if (entry.type == 'wi') {
                                strat.textContent = strategy[getStrategy(entry)];
                            } else if (entry.type == 'mes') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-comments');
                                strat.setAttribute('data-stwii--count', entry.count.toString());
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
function startBuildSession() {
        STWII.currentRunId = Date.now();
        stwiiCurrentBuild = { runId: STWII.currentRunId, startedAt: Date.now(), added: [], logs: [] };
    }
function endBuildSession() {
        if (!stwiiCurrentBuild) return;
        stwiiCurrentBuild.chatId = getCurrentChatId();
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

    //! HACK: no event when no entries are activated, only a debug message
    (function(){
        const STWII = (window.STWII ||= {});
        if (STWII.consolePatched) return;
        STWII.origDebug = console.debug;
        STWII.origLog = console.log;
    const original_debug = console.debug;
    console.debug = function(...args) {
        // capture WI activation details
        try { handleWiDebugArgs(args); } catch {}

        // Track build session boundaries and capture counts (ignore DRY RUNs)
        try {
            const first = String(args[0] ?? '');
            const asText = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
            if (stwiiCurrentBuild && asText) pushBounded(stwiiCurrentBuild.logs, asText, STWII.MAX_BUILD_LOGS);

            // Start/end markers
            if (asText.includes('[WI] --- START WI SCAN') && !stwiiCurrentBuild) startBuildSession();
            if (first.includes('--- BUILDING PROMPT ---') && !stwiiCurrentBuild) startBuildSession();
            if (first.includes('--- DONE ---')) endBuildSession();

            // Detect WI scan start to reset loop counts; track DRY RUNs
            if (asText.includes('[WI] --- START WI SCAN')) {
                stwiiDryRunActive = asText.includes('(DRY RUN)');
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

            // On BUILDING PROMPT, finalize loop counts (and captured entry IDs) for non-dry run
            if (asText.includes('[WI] --- BUILDING PROMPT ---') && !stwiiDryRunActive && Array.isArray(stwiiCurrentLoopCounts)) {
                chat_metadata.stwiiLastLoopCounts = [...stwiiCurrentLoopCounts];
                if (Array.isArray(stwiiCurrentLoopEntryIds)) {
                    chat_metadata.stwiiLastLoopEntryIds = stwiiCurrentLoopEntryIds.map(a => Array.isArray(a) ? [...a] : null);
                }
            }

            // Capture final "Adding N entries to prompt" (ignore "Hypothetically")
            const mAdd = asText.match(/\[\s*WI\s*\]\s+Adding\s+(\d+)\s+entries\s+to\s+prompt\b/i);
            if (mAdd && !stwiiDryRunActive) {
                const n = Number(mAdd[1]);
                if (Number.isFinite(n)) chat_metadata.stwiiLastAddedCount = n;
            }
        } catch {}

        // No UI changes here: zero-entry and dry-run debug logs are not definitive.
        return original_debug.bind(console)(...args);
    };
    const original_log = console.log;
    console.log = function(...args) {
        // capture WI activation details (just in case)
        try { handleWiDebugArgs(args); } catch {}

        // Track build session boundaries and capture counts (ignore DRY RUNs)
        try {
            const first = String(args[0] ?? '');
            const asText = args.map(a => (typeof a === 'string' ? a : '')).join(' ');
            if (stwiiCurrentBuild && asText) pushBounded(stwiiCurrentBuild.logs, asText, STWII.MAX_BUILD_LOGS);

            // Start/end markers
            if (asText.includes('[WI] --- START WI SCAN') && !stwiiCurrentBuild) startBuildSession();
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

            // On BUILDING PROMPT, finalize loop counts (and captured entry IDs) for non-dry run
            if (asText.includes('[WI] --- BUILDING PROMPT ---') && !stwiiDryRunActive && Array.isArray(stwiiCurrentLoopCounts)) {
                chat_metadata.stwiiLastLoopCounts = [...stwiiCurrentLoopCounts];
                // Prefer ids captured via LOOP START/RESULT + activation commits; fallback to ids captured from success-line arrays
                let finalIds = null;
                if (Array.isArray(stwiiCurrentLoopEventIds) && stwiiCurrentLoopEventIds.some(a => Array.isArray(a) && a.length)) {
                    finalIds = stwiiCurrentLoopEventIds.map(a => Array.isArray(a) ? [...a] : null);
                } else if (Array.isArray(stwiiCurrentLoopEntryIds)) {
                    finalIds = stwiiCurrentLoopEntryIds.map(a => Array.isArray(a) ? [...a] : null);
                }
                if (finalIds) {
                    chat_metadata.stwiiLastLoopEntryIds = finalIds;
                }
            }

            // Capture final "Adding N entries to prompt" (ignore "Hypothetically")
            const mAdd = asText.match(/\[\s*WI\s*\]\s+Adding\s+(\d+)\s+entries\s+to\s+prompt\b/i);
            if (mAdd && !stwiiDryRunActive) {
                const n = Number(mAdd[1]);
                if (Number.isFinite(n)) chat_metadata.stwiiLastAddedCount = n;
            }
        } catch {}

        // No UI changes here: zero-entry and dry-run debug logs are not definitive.
        return original_log.bind(console)(...args);
    };
    STWII.unpatchConsole = function() {
        try { console.debug = STWII.origDebug; } catch {}
        try { console.log = STWII.origLog; } catch {}
        STWII.consolePatched = false;
    };
    STWII.consolePatched = true;
})();

// Optional teardown to remove UI and unpatch console
window.STWII.destroy = function() {
    closeLoreViewer();
    try { window.STWII.unpatchConsole?.(); } catch {}
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
            // Prefer the confirmed compact report; legacy logs remain readable.
            const compact = chat_metadata.stwiiLastReport;
            const freshMemory = lastReportBuild?.chatId === getCurrentChatId()
                && lastReportBuild?.runId === compact?.runId ? lastReportBuild : null;
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
                ? s.replace(/\s*-\s*S[0-9][0-9A-Za-z.\-]*\s*$/, '').trim()
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
