// Read-only compatibility with Lorebook Manager's per-book translation files.
// Called only when WorldInfo Info's original floating reader is opened.
const STORE_FORMAT = 'lore-manager-translations-v1';
const SEPARATOR = '\u241f';

function stableBookHash(value) {
    let a = 0x811c9dc5;
    let b = 0x85ebca6b;
    for (const point of String(value)) {
        const code = point.codePointAt(0);
        a = Math.imul(a ^ code, 0x01000193) >>> 0;
        b = Math.imul(b ^ (code & 65535), 0x27d4eb2d) >>> 0;
        b = Math.imul(b ^ (code >>> 16), 0x27d4eb2d) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function managerTranslationBookPath(book) {
    if (typeof book !== 'string' || !book) return null;
    // Exactly match lore-manager/translation-storage.js, including Unicode.
    const slug = book.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'book';
    return '/user/files/lore-manager-translation-' + slug + '-' + stableBookHash(book) + '.json';
}

export async function readManagerTranslationBook(book, request, headers = null) {
    const path = managerTranslationBookPath(book);
    if (!path || typeof request !== 'function') return null;
    try {
        const response = await request(path, {
            method: 'GET',
            credentials: 'same-origin',
            ...(headers ? { headers } : {}),
            cache: 'no-store',
        });
        if (!response?.ok) return null;
        const data = await response.json();
        if (data?.format !== STORE_FORMAT || data.book !== book
            || !Number.isSafeInteger(data.revision) || data.revision < 1
            || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)
            || !data.pairs || typeof data.pairs !== 'object' || Array.isArray(data.pairs)) return null;
        return data;
    } catch {
        // Missing, unavailable or malformed server files cannot break the
        // original viewer. The legacy settings/RT fallback remains available.
        return null;
    }
}

function recordForEntry(entry, snapshot, legacySettings) {
    const key = String(entry?.world ?? '') + SEPARATOR + String(entry?.uid ?? '');
    const fileRecord = snapshot?.records?.[key];
    const record = fileRecord ?? legacySettings?.translations?.[key];
    const language = snapshot?.pairs?.[key]?.translationLanguage
        ?? legacySettings?.entryLanguagePairs?.[key]?.translationLanguage;
    if (!record || !['Korean', 'English'].includes(record.language)
        || (language && language !== record.language)) return null;
    return record;
}

function hashBody(source) {
    const text = String(source ?? '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(36) + '_' + text.length;
}

export function managerTranslatedTitle(entry, snapshot, legacySettings) {
    const record = recordForEntry(entry, snapshot, legacySettings);
    const original = String(entry?.comment ?? '');
    const field = record?.fields?.comment;
    return field?.source === original && typeof field.text === 'string' ? field.text.trim() : '';
}

export function managerTranslatedBody(entry, snapshot, legacySettings) {
    const record = recordForEntry(entry, snapshot, legacySettings);
    const source = String(entry?.content ?? '');
    return record?.sourceHash === hashBody(source)
        && typeof record.text === 'string' && record.text.trim() ? record.text : null;
}
