// Optional, on-demand navigation to Ambasa's independent Lorebook Library.
// Never import or depend on the manager; absence or any failure returns false.
export async function tryOpenInLoreLibrary(entry, enabled, bridge) {
    if (!enabled || bridge?.apiVersion !== 1 || typeof bridge.openEntry !== 'function'
        || typeof entry?.world !== 'string' || !/^\d+$/.test(String(entry?.uid ?? ''))) return false;
    try {
        return await bridge.openEntry({ book: entry.world, uid: entry.uid }) === true;
    } catch {
        return false;
    }
}
