const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
function extract(start, end) {
    const a = source.indexOf(start);
    const b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return source.slice(a, b);
}
function run(bounds, triggerRect, sizes) {
    function panel(size) {
        return {
            style: { setProperty(name, value) { this[name] = value; } },
            classList: { contains() { return true; } },
            getBoundingClientRect() { return size; },
        };
    }
    const list = panel(sizes[0]), settings = panel(sizes[1]);
    const ctx = vm.createContext({
        window: { visualViewport: { offsetLeft: bounds.left, offsetTop: bounds.top, width: bounds.width, height: bounds.height } },
        trigger: { getBoundingClientRect: () => triggerRect },
        panel: list, configPanel: settings, keepTriggerVisible() {},
    });
    vm.runInContext(extract('    function getVisibleBounds() {','    function setTriggerPosition(')
        + extract('    function placePanelNearTrigger(el) {','    STWII.repairPositions = ensurePanelsVisible;')
        + '\nensurePanelsVisible();', ctx);
    return [list.style, settings.style];
}
test('list and right-click settings share the book top on desktop', () => {
    const [list, settings] = run({left:0,top:0,width:1200,height:900},
        {left:200,right:240,top:220,height:40}, [{width:220,height:100},{width:300,height:340}]);
    assert.equal(list.top,'220px');
    assert.equal(settings.top,'220px');
    assert.equal(settings.left,'243px');
});
test('mobile long-press and list align to the same top with visualViewport offsets', () => {
    const [list,settings] = run({left:0,top:120,width:390,height:500},
        {left:340,right:380,top:180,height:40}, [{width:180,height:100},{width:260,height:240}]);
    assert.equal(list.top,'180px');
    assert.equal(settings.top,'180px');
    assert.equal(settings.left,'77px');
});
test('both popups remain completely visible near bottom of a small viewport', () => {
    const [list,settings] = run({left:0,top:0,width:390,height:500},
        {left:8,right:48,top:452,height:40}, [{width:180,height:100},{width:280,height:300}]);
    assert.equal(list.top,'397px');
    assert.equal(settings.top,'197px');
    assert.equal(settings['max-height'],'350px');
});

test('destroy releases all global gesture handlers and cancels a pending long press', () => {
    const registrations = extract("    trigger.addEventListener('pointerdown', onLongPressPointerDown);", '    // Prevent click toggle');
    const cleanup = extract('    // Release global gesture handlers before removing their trigger.', '    try {\n        const t = window.STWII.trigger;');
    const listeners = new Map();
    const window = {
        addEventListener(type, handler) {
            const set = listeners.get(type) || new Set();
            set.add(handler);
            listeners.set(type, set);
        },
        removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    };
    const cancelled = [];
    const ctx = vm.createContext({
        window,
        trigger: { addEventListener() {} },
        onLongPressPointerDown() {},
        onPointerDown() {},
        onLongPressPointerMove() {},
        onPointerMove() {},
        endDrag() {},
        longPressTimer: 7,
        longPressPointerId: 2,
        dragging: true,
        movedEnough: true,
        cancelled,
        clearTimeout(id) { cancelled.push(id); },
    });
    // Use the actual production timer cleanup rather than a no-op stub.
    vm.runInContext(extract('    function clearLongPress() {', '    function onLongPressPointerDown(e) {'), ctx);
    vm.runInContext(registrations, ctx);
    assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 6);
    vm.runInContext(cleanup, ctx);
    assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 0);
    assert.deepEqual(cancelled, [7]);
    assert.equal(ctx.longPressTimer, null);
    assert.equal(ctx.longPressPointerId, null);
    assert.equal(ctx.dragging, false);
    assert.equal(ctx.movedEnough, false);
    // A fresh initialization must have one copy of each handler.
    vm.runInContext(registrations, ctx);
    assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 6);
});
