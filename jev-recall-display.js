// Transient, optional receipt from Memory Books. No lorebook reads, prompt
// mutations, or Jev requests. Receipts are tied to the exact WI load payload.
export function createJevRecallReceipts() {
    let receipts = new WeakMap();
    let selected = null;

    function validPayload(lists) {
        return lists !== null && typeof lists === 'object';
    }

    function normalizeUid(uid) {
        if (typeof uid !== 'number' && !(typeof uid === 'string' && /^\d+$/.test(uid))) return null;
        const value = Number(uid);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }

    return {
        record(lists, world, uids) {
            if (!validPayload(lists) || typeof world !== 'string' || !world ||
                !(uids instanceof Set || Array.isArray(uids))) return false;
            const ids = new Set();
            for (const uid of uids) {
                const normalized = normalizeUid(uid);
                if (normalized !== null) ids.add(normalized);
            }
            receipts.set(lists, { world, ids });
            return true;
        },
        consume(lists) {
            selected = validPayload(lists) ? receipts.get(lists) ?? null : null;
            if (validPayload(lists)) receipts.delete(lists);
        },
        annotate(entry) {
            const copy = { ...entry };
            // Never trust an arbitrary property from a lorebook file.
            delete copy.stwiiJevRecall;
            if (selected && entry?.world === selected.world && entry.constant === true &&
                entry.disable !== true && selected.ids.has(normalizeUid(entry.uid))) {
                copy.stwiiJevRecall = true;
            }
            return copy;
        },
        reset() {
            receipts = new WeakMap();
            selected = null;
        },
    };
}
