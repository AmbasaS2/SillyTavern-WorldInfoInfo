// Optional STLO Jev recall receipts. Match the exact transient WI load payload
// and book + UID, never a saved entry flag, title or candidate score.
// No lorebook reads, generation mutation, or additional Jev requests.
export function createJevRecallReceipts() {
    let receipts = new WeakMap();
    let activeLists = null;

    function validPayload(lists) {
        return lists !== null && typeof lists === 'object';
    }

    function entryKey(world, uid) {
        if (typeof world !== 'string' || !world) return null;
        if (typeof uid !== 'number' && !(typeof uid === 'string' && /^\d+$/.test(uid))) return null;
        const value = Number(uid);
        return Number.isSafeInteger(value) && value >= 0 ? JSON.stringify([world, value]) : null;
    }

    return {
        record(lists, appliedKeys) {
            if (!validPayload(lists) || !(appliedKeys instanceof Set)) return false;
            const keys = new Set();
            for (const raw of appliedKeys) {
                if (typeof raw !== 'string') continue;
                try {
                    const pair = JSON.parse(raw);
                    if (!Array.isArray(pair) || pair.length !== 2) continue;
                    const key = entryKey(pair[0], pair[1]);
                    if (key !== null) keys.add(key);
                } catch { /* Ignore malformed keys. */ }
            }
            receipts.set(lists, keys);
            return true;
        },
        consume(lists) {
            // STLO may run before or after this listener. Keep the payload
            // identity rather than taking an early snapshot of the receipt.
            if (activeLists && activeLists !== lists) receipts.delete(activeLists);
            activeLists = validPayload(lists) ? lists : null;
        },
        annotate(entry) {
            const copy = { ...entry };
            // A saved entry property alone is not evidence of Jev activation.
            delete copy.stwiiJevRecall;
            const selected = activeLists ? receipts.get(activeLists) : null;
            // STLO adds a transient @@activate decorator, not a constant flag.
            // SillyTavern parses the directive into the decorators array.
            if (entry?.constant !== true && entry?.disable !== true &&
                Array.isArray(entry?.decorators) && entry.decorators.includes('@@activate') &&
                selected?.has(entryKey(entry?.world, entry?.uid))) {
                copy.stwiiJevRecall = true;
            }
            return copy;
        },
        reset() {
            receipts = new WeakMap();
            activeLists = null;
        },
    };
}
