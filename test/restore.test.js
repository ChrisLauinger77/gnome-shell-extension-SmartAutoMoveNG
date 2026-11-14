"use strict";

// Run with: node --experimental-vm-modules test/restore.test.js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { URL } from "node:url";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";

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
    "gi://Meta": { default: { WindowType: { NORMAL: 0, UTILITY: 1 } } },
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
        ? await import("../SmartAutoMoveNG@lauinger-clan.de/lib/common.js")
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


function ciderWindow(id, title, { skipTaskbar = false, type = 0 } = {}) {
    const handlers = new Map();
    return {
        title,
        data: { hash: id, title, occupied: true, x: 100, y: 100, width: 352, height: 152 },
        get_id: () => id,
        get_wm_class: () => "cider",
        get_title() { return this.title; },
        get_role: () => null,
        get_window_type: () => type,
        is_skip_taskbar: () => skipTaskbar,
        can_maximize: () => false,
        can_minimize: () => false,
        get_transient_for: () => null,
        is_above: () => false,
        is_on_all_workspaces: () => false,
        get_workspace: () => ({}),
        connect(signal, callback) { handlers.set(signal, callback); return signal; },
        disconnect(signal) { handlers.delete(signal); },
        emit(signal) { handlers.get(signal)?.(); },
        handlers,
    };
}

function ciderExtension(savedWindows = {}) {
    const extension = new extensionModule.namespace.default();
    Object.assign(extension, {
        _savedWindows: savedWindows,
        _windowRoles: new Map(),
        _nonPersistentWindows: new Map(),
        _activeRestores: new Map(),
        _restoreSaveGuards: new Map(),
        _reservedSavedWindows: new Map(),
        _provisionalPictureInPictureWindows: new Map(),
        _trackedWindows: new Map(),
        _overrides: {},
        _matchThreshold: 0.5,
        _syncMode: 1,
        _startupDelayMs: 0,
        _windowNewerThan: () => false,
        _debug() {},
        _queueSaveSettings() {},
        _trackWindow() {},
        _setRestoreSaveGuard() {},
        _windowData(win) {
            const data = { ...win.data, title: win.title };
            const role = this._windowRole(win);
            if (role !== null) data.window_role = role;
            return data;
        },
        async _moveWindow(win, saved) {
            win.restored = saved;
            return saved;
        },
    });
    return extension;
}

for (const miniFirst of [false, true]) {
    test(`saves Cider windows separately with miniplayer opening ${miniFirst ? "first" : "second"}`, async () => {
        const extension = ciderExtension();
        const main = ciderWindow(1, "Cider");
        const mini = ciderWindow(2, "Cider - Mini Player");
        await extension._syncWindow(miniFirst ? mini : main);
        await extension._syncWindow(miniFirst ? main : mini);
        assert.equal(extension._savedWindows.cider.length, 2);
        assert.equal(extension._matchingSavedWindow(main)[1].title, "Cider");
        assert.equal(extension._matchingSavedWindow(mini)[1].window_role, "picture-in-picture");
        assert.equal(extension._nonPersistentWindows.size, 0);
        // Further normal Cider windows still share the single normal slot.
        await extension._syncWindow(ciderWindow(3, "Cider"));
        assert.equal(extension._savedWindows.cider.length, 2);
    });
}

test("restores Cider miniplayer geometry without using or occupying the main window slot", async () => {
    const mainSaved = { ...savedWindow, title: "Cider", occupied: true, hash: 1 };
    const miniSaved = {
        ...savedWindow, title: "Cider - Mini Player", occupied: false,
        x: 500, y: 200, width: 352, height: 152, window_role: "picture-in-picture",
    };
    const extension = ciderExtension({ cider: [mainSaved, miniSaved] });
    const mini = ciderWindow(2, "Cider - Mini Player");
    await extension._syncWindow(mini);
    assert.equal(mini.restored, miniSaved);
    assert.equal(mainSaved.hash, 1);
    assert.equal(miniSaved.hash, 2);
    assert.equal(miniSaved.occupied, true);
    assert.equal(extension._nonPersistentWindows.size, 0);
    assert.equal(extension._activeRestores.size, 0);
    assert.equal(extension._reservedSavedWindows.size, 0);
});

test("retries a skipped Cider popup when its miniplayer title arrives and removes provisional signals", () => {
    const extension = ciderExtension();
    const mini = ciderWindow(2, "", { skipTaskbar: true, type: 1 });
    assert.equal(extension._shouldSkipWindow(mini), true);
    extension._trackProvisionalPictureInPictureWindow(mini);
    assert.equal(extension._provisionalPictureInPictureWindows.size, 1);
    let retried;
    extension._syncWindowWithErrorLogging = (win) => { retried = win; };
    mini.title = "Cider - Mini Player";
    mini.emit("notify::title");
    assert.equal(retried, mini);
    assert.equal(extension._shouldSkipWindow(mini), false);
    assert.equal(extension._provisionalPictureInPictureWindows.size, 0);
    assert.equal(mini.handlers.size, 0);
});
