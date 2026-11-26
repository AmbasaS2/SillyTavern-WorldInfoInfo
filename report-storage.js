// Keep just one report in chat metadata. All diagnostic logs stay in RAM.
export const REPORT_MAX_BYTES = 64 * 1024;
const LEGACY_KEYS = [
    'stwiiBuilds', 'stwiiActivationEvents',
    'stwiiLastLoopCounts', 'stwiiLastLoopEntryIds', 'stwiiLastAddedCount',
];
const EVENT_FIELDS = [
    'world', 'uid', 'comment', 'constant', 'vectorized', 'keys',
    'primary', 'secondary', 'logic', 'vectorConfirmed', 'reason', 'jevConfirmed',
];
const encoder = new TextEncoder();

function keyOf(entry) {
    return String(entry.world) + ':' + String(entry.uid);
}

export function reportBytes(report) {
    // Include the metadata property name and JSON structure in the UTF-8 budget.
    return encoder.encode(JSON.stringify({ stwiiLastReport: report })).byteLength;
}

// A missing activation event alone cannot distinguish no lore from a failed
// diagnostic capture. ST omits that event when the final activated count is zero.
export function canReplaceReport(build, observedCount, candidates) {
    if (!build?.startedFromScan || !build?.finished || !Array.isArray(build.added) ||
        !Number.isSafeInteger(build.finalCount) || build.finalCount < 0 ||
        !Array.isArray(candidates)) return false;
    if (build.finalCount === 0) {
        return (observedCount === null || observedCount === 0) && candidates.length === 0;
    }
    if (observedCount !== build.finalCount || candidates.length !== observedCount) return false;
    if (!Array.isArray(build.loopCounts) || !build.loopCounts.length ||
        !build.loopCounts.every(n => Number.isSafeInteger(n) && n >= 0) ||
        build.loopCounts.reduce((sum, n) => sum + n, 0) < build.finalCount) return false;
    const captured = new Set(build.added.map(keyOf));
    return candidates.every(entry => captured.has(keyOf(entry)));
}

export function compactReport(report) {
    const added = report.added.map(event => {
        const result = {};
        for (const field of EVENT_FIELDS) {
            if (Object.hasOwn(event, field)) result[field] = event[field];
        }
        return result;
    });
    const loopCounts = Array.isArray(report.loopCounts) ? report.loopCounts : [];
    const loopEntryIds = Array.isArray(report.loopEntryIds) ? report.loopEntryIds : [];
    const runId = Number.isSafeInteger(report.runId) ? report.runId : Date.now();
    const full = { runId, added, loopCounts, loopEntryIds };
    if (reportBytes(full) <= REPORT_MAX_BYTES) return full;

    // Only the persisted copy is limited. Keep complete events in scan order.
    // A partial report uses exact loop IDs, never guesses where omitted events
    // belonged. Drop its loop breakdown if the engine did not supply exact IDs.
    const exactLoops = loopCounts.every((n, i) => Number.isSafeInteger(n) && n >= 0 &&
        (n === 0 || (Array.isArray(loopEntryIds[i]) && loopEntryIds[i].length === n)));
    const candidate = n => {
        const events = added.slice(0, n);
        const result = { runId, added: events, loopCounts: [], loopEntryIds: [], truncated: true };
        if (n > 0 && exactLoops) {
            const ids = new Set(events.map(keyOf));
            const groups = loopCounts.map((_, i) => (Array.isArray(loopEntryIds[i]) ? loopEntryIds[i] : []).filter(id => ids.has(id)));
            while (groups.length && groups.at(-1).length === 0) groups.pop();
            result.loopCounts = groups.map(group => group.length);
            result.loopEntryIds = groups;
        }
        return result;
    };
    // The size grows monotonically with the retained prefix. One full-size
    // check in the common case; binary search only on oversized reports.
    let low = 0, high = added.length;
    let best = candidate(0);
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const next = candidate(mid);
        if (reportBytes(next) <= REPORT_MAX_BYTES) {
            best = next;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return best;
}

// Called after a successful visible prompt build only. No file I/O or save call.
// Build the replacement before touching the old data, so failures are safe.
export function persistReport(metadata, report, complete) {
    if (!complete) return false;
    const compact = compactReport(report);
    metadata.stwiiLastReport = compact;
    for (const key of LEGACY_KEYS) delete metadata[key];
    return true;
}
