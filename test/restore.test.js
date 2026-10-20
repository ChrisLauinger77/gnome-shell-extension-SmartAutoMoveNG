"use strict";

// Run with: node --experimental-vm-modules test/restore.test.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { URL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import * as Common from "../SmartAutoMoveNG@lauinger-clan.de/lib/common.js";

const context = createContext({
    global: {
        display: { get_n_monitors: () => 2 },
        workspace_manager: {
            n_workspaces: 3,
            get_workspace_by_index: () => ({ active: true }),
        },
    },
});
const shellModules = {
    "gi://Meta": { default: {} },
    "gi://GLib": { default: { PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false } },
    "gi://Gio": { default: {} },
    "gi://GObject": { default: { registerClass: (klass) => klass } },
    "gi://Shell": { default: {} },
    "gi://St": { default: {} },
    "resource:///org/gnome/shell/extensions/extension.js": {
        Extension: class {},
        InjectionManager: class {},
        gettext: (value) => value,
    },
    "resource:///org/gnome/shell/ui/quickSettings.js": {
        QuickMenuToggle: class {},
        SystemIndicator: class {},
    },
    "resource:///org/gnome/shell/ui/main.js": { panel: { statusArea: { quickSettings: {} } } },
    "resource:///org/gnome/shell/ui/popupMenu.js": {},
};
const extensionModule = new SourceTextModule(
    await readFile(new URL("../SmartAutoMoveNG@lauinger-clan.de/extension.js", import.meta.url), "utf8"),
    { context }
);
await extensionModule.link(async (specifier) => {
    const exports = specifier === "./lib/common.js"
        ? Common
        : shellModules[specifier];
    assert.ok(exports, `Unexpected runtime import: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
});
await extensionModule.evaluate();

const savedWindow = {
    monitor: 1,
    workspace: 0,
    on_all_workspaces: true,
    x: 2100,
    y: 150,
    width: 800,
    height: 600,
    maximized: false,
    fullscreen: false,
    above: false,
};

class WaylandWindow {
    constructor({ maximized = false, fullscreen = false } = {}) {
        this.frame = { x: 100, y: 100, width: 1000, height: 700 };
        this.maximized_horizontally = maximized;
        this.maximized_vertically = maximized;
        this.fullscreen = fullscreen;
        this.monitor = 0;
        this.calls = [];
    }

    is_fullscreen() {
        return this.fullscreen;
    }

    unmake_fullscreen() {
        this.calls.push("unfullscreen");
        this.fullscreen = false;
        // Mutter 51 processes a config even when already non-fullscreen. On
        // Wayland, the current frame may still precede an uncommitted resize.
        this.pendingFrame = { ...this.frame };
    }

    unmaximize() {
        this.calls.push("unmaximize");
        this.maximized_horizontally = false;
        this.maximized_vertically = false;
        this.pendingFrame = { ...this.frame };
    }

    move_to_monitor(monitor) {
        this.calls.push("monitor");
        this.frame.x += (monitor - this.monitor) * 1920;
        this.monitor = monitor;
    }

    stick() {
        this.onAllWorkspaces = true;
    }

    unstick() {
        this.onAllWorkspaces = false;
    }

    change_workspace_by_index(workspace) {
        this.workspace = workspace;
    }

    move_resize_frame(_userOperation, x, y, width, height) {
        this.calls.push("geometry");
        if (this.fullscreen || this.maximized_horizontally || this.maximized_vertically) return;
        this.pendingFrame = { x, y, width, height };
    }

    maximize() {
        this.maximized_horizontally = true;
        this.maximized_vertically = true;
    }

    make_fullscreen() {
        this.calls.push("fullscreen");
        this.fullscreen = true;
    }

    make_above() {}

    unmake_above() {}

    commit() {
        if (this.pendingFrame) this.frame = this.pendingFrame;
    }
}

async function restoreGeometry(win, saved = savedWindow, options = {}) {
    const extension = new extensionModule.namespace.default();
    let completeMove;
    Object.assign(extension, {
        _ignoreMonitor: false,
        _ignoreWorkspace: false,
        _ignorePosition: false,
        _moveWindowDelays: new Map(),
        _debug() {},
        _windowData: (window) => ({ ...window.frame }),
        _addTimeout(_priority, _duration, callback) {
            completeMove = callback;
            return 1;
        },
        ...options,
    });
    const move = extension._moveWindow(win, saved);
    win.commit();
    completeMove();
    return move;
}

function assertSavedGeometry(win) {
    assert.deepEqual(win.frame, {
        x: savedWindow.x,
        y: savedWindow.y,
        width: savedWindow.width,
        height: savedWindow.height,
    });
    assert.equal(win.monitor, 1);
    assert.equal(win.onAllWorkspaces, true);
}

test("restores a queued Wayland resize on a secondary monitor without resending the old geometry", async () => {
    const win = new WaylandWindow();
    await restoreGeometry(win);
    assertSavedGeometry(win);
    assert.ok(!win.calls.includes("unfullscreen"));
    assert.ok(!win.calls.includes("unmaximize"));
});

test("leaves fullscreen before restoring normal geometry", async () => {
    const win = new WaylandWindow({ fullscreen: true });
    await restoreGeometry(win);
    assertSavedGeometry(win);
    assert.equal(win.fullscreen, false);
    assert.equal(win.calls[0], "unfullscreen");
});

test("unmaximizes before restoring normal geometry", async () => {
    const win = new WaylandWindow({ maximized: true });
    await restoreGeometry(win);
    assertSavedGeometry(win);
    assert.equal(win.maximized_horizontally, false);
    assert.equal(win.maximized_vertically, false);
    assert.equal(win.calls[0], "unmaximize");
});

test("clears partial maximization before restoring normal geometry", async () => {
    const win = new WaylandWindow();
    win.maximized_vertically = true;
    await restoreGeometry(win);
    assertSavedGeometry(win);
    assert.equal(win.maximized_vertically, false);
});

test("restores saved maximized and fullscreen states", async () => {
    const maximized = new WaylandWindow();
    await restoreGeometry(maximized, { ...savedWindow, maximized: true });
    assert.equal(maximized.maximized_horizontally, true);
    assert.equal(maximized.maximized_vertically, true);

    const fullscreen = new WaylandWindow();
    await restoreGeometry(fullscreen, { ...savedWindow, fullscreen: true });
    assert.equal(fullscreen.fullscreen, true);
    assert.equal(fullscreen.calls.at(-1), "fullscreen");
});

test("does not reapply fullscreen when it is already set", async () => {
    const win = new WaylandWindow({ fullscreen: true });
    await restoreGeometry(win, { ...savedWindow, fullscreen: true });
    assert.ok(!win.calls.includes("fullscreen"));
    assert.ok(!win.calls.includes("unfullscreen"));
});

test("honors ignored position, monitor and workspace settings", async () => {
    const win = new WaylandWindow();
    const originalPosition = { x: win.frame.x, y: win.frame.y };
    await restoreGeometry(win, savedWindow, {
        _ignorePosition: true,
        _ignoreMonitor: true,
        _ignoreWorkspace: true,
    });
    assert.deepEqual(win.frame, { ...originalPosition, width: savedWindow.width, height: savedWindow.height });
    assert.equal(win.monitor, 0);
    assert.equal(win.onAllWorkspaces, undefined);
});

function createRestoreState({ hash = 42, title = "", occupied = true } = {}) {
    const win = new WaylandWindow();
    Object.assign(win, {
        get_id: () => hash,
        get_transient_for: () => null,
        get_workspace: () => ({ index: () => 0 }),
        connect: () => 1,
        disconnect() {},
    });
    const saved = { ...savedWindow, id: 42, hash: 42, sequence: 42, title, occupied };
    const extension = new extensionModule.namespace.default();
    Object.assign(extension, {
        _savedWindows: { app: [saved] },
        _overrides: {},
        _matchThreshold: 0.7,
        _syncMode: Common.SYNC_MODE_RESTORE,
        _activeWindows: new Map(),
        _activeRestores: new Map(),
        _nonPersistentWindows: new Map(),
        _reservedSavedWindows: new Map(),
        _restoreSaveGuards: new Map(),
        _startupDelayMs: 0,
        _freezeSaves: false,
        _windowSectionHash: () => "app",
        _windowRole: () => null,
        _windowTitle: () => title,
        _windowRepr: () => "app window",
        _windowData: (window) => ({
            ...savedWindow,
            ...window.frame,
            id: hash,
            hash,
            sequence: hash,
            title,
            occupied: true,
        }),
        _moveWindow: restoreGeometry,
        _addTimeout: () => 1,
        _removeTimeout() {},
        _queueSaveSettings() {},
        _debug() {},
    });
    return { extension, win };
}

for (const title of ["", "Window"]) {
    test(`restores and keeps saving an occupied owner with title ${JSON.stringify(title)} after re-enabling or recycling its ID`, async () => {
        const { extension, win } = createRestoreState({ title });
        assert.equal(await extension._restoreWindow(win), true);
        assertSavedGeometry(win);
        assert.equal(extension._nonPersistentWindows.has(win), false);

        extension._clearRestoreSaveGuard(win);
        win.frame.x = 2500;
        win.frame.width = 900;
        extension._ensureSavedWindow(win);
        assert.equal(extension._savedWindows.app[0].x, 2500);
        assert.equal(extension._savedWindows.app[0].width, 900);
    });
}

test("claims an unoccupied saved slot for an empty-title window with a new ID", async () => {
    const { extension, win } = createRestoreState({ hash: 43, occupied: false });
    assert.equal(await extension._restoreWindow(win), true);
    assertSavedGeometry(win);
    assert.equal(extension._savedWindows.app[0].hash, 43);
    assert.equal(extension._nonPersistentWindows.has(win), false);
});

test("keeps a second empty-title window from overwriting the occupied owner's geometry", async () => {
    const { extension, win } = createRestoreState({ hash: 43 });
    extension._activeWindows.set(42, Date.now());
    assert.equal(await extension._restoreWindow(win), true);
    assertSavedGeometry(win);
    assert.equal(extension._nonPersistentWindows.has(win), true);

    extension._clearRestoreSaveGuard(win);
    win.frame.x = 2500;
    extension._ensureSavedWindow(win);
    assert.equal(extension._savedWindows.app[0].hash, 42);
    assert.equal(extension._savedWindows.app[0].x, savedWindow.x);
    assert.equal(await extension._restoreWindow(win), true);
    assert.equal(win.frame.x, 2500);
});

test("keeps an already tracked owner in place while saving its new geometry", async () => {
    const { extension, win } = createRestoreState();
    extension._activeWindows.set(42, Date.now());
    assert.equal(await extension._restoreWindow(win), false);

    extension._ensureSavedWindow(win);
    assert.equal(extension._savedWindows.app[0].x, win.frame.x);
});

for (const title of ["", "Window"]) {
    for (const ownerFirst of [true, false]) {
        test(`prefers the exact owner over a free legacy slot with title ${JSON.stringify(title)} (owner first: ${ownerFirst})`, async () => {
            const { extension, win } = createRestoreState({ title });
            const owner = extension._savedWindows.app[0];
            const free = { ...owner, id: 99, hash: 99, sequence: 99, occupied: false, x: 400, width: 500 };
            extension._savedWindows.app = ownerFirst ? [owner, free] : [free, owner];

            assert.equal(await extension._restoreWindow(win), true);
            assertSavedGeometry(win);
            assert.equal(extension._savedWindows.app.filter((sw) => sw.occupied && sw.hash === 42).length, 1);
            assert.equal(free.hash, 99);
            assert.equal(free.occupied, false);

            extension._clearRestoreSaveGuard(win);
            win.frame.x = 2500;
            extension._ensureSavedWindow(win);
            assert.equal(extension._savedWindows.app.find((sw) => sw.hash === 42).x, 2500);
            assert.equal(free.x, 400);

            extension._deoccupySavedWindow(42);
            assert.equal(extension._savedWindows.app.find((sw) => sw.hash === 42).occupied, false);
            assert.equal(free.hash, 99);
        });
    }
}

test("keeps role matching when a recycled ID belongs to a saved window of another role", async () => {
    const title = "Picture in Picture";
    const { extension, win } = createRestoreState({ title });
    const normal = { ...extension._savedWindows.app[0], title: "Mozilla Firefox", window_role: null };
    const pip = {
        ...normal,
        id: 99,
        hash: 99,
        title,
        occupied: false,
        x: 400,
        window_role: Common.WINDOW_ROLE_PICTURE_IN_PICTURE,
    };
    extension._savedWindows = { firefox: [normal, pip] };
    extension._windowSectionHash = () => "firefox";
    extension._windowRole = () => Common.WINDOW_ROLE_PICTURE_IN_PICTURE;

    assert.equal(await extension._restoreWindow(win), true);
    assert.equal(win.frame.x, 400);
    assert.equal(normal.x, savedWindow.x);
});
