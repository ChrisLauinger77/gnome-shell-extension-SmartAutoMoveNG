"use strict";

// imports
import Meta from "gi://Meta";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Shell from "gi://Shell";
import St from "gi://St";

import { Extension, InjectionManager, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Common from "./lib/common.js";

const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

//quick settings
const SmartAutoMoveNGMenuToggle = GObject.registerClass(
    class SmartAutoMoveNGMenuToggle extends QuickSettings.QuickMenuToggle {
        constructor(extension) {
            const { _settings } = extension;
            super({
                title: "Smart Auto Move NG",
                toggleMode: true,
            });
            // Icon
            this.gicon = extension._finalMenuIcon;
            this.menu.setHeader(extension._finalMenuIcon, "Smart Auto Move NG", "");
            // Bind toggle (robust enum handling)
            this.bindToggleToSetting(_settings);
            // Menu item Saved Windows with subnmenu Cleanup Non-occupied Windows
            const popupMenuExpander = new PopupMenu.PopupSubMenuMenuItem(_("Saved Windows"));
            this.menu.addMenuItem(popupMenuExpander);
            const submenu = new PopupMenu.PopupMenuItem(_("Cleanup Non-occupied Windows"));
            submenu.connect("activate", Common.cleanupNonOccupiedWindows.bind(this, _settings));
            popupMenuExpander.menu.addMenuItem(submenu);
            try {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                const settingsItem = this.menu.addAction(_("Settings"), () => {
                    extension.openPreferences();
                    QuickSettingsMenu.menu.close(PopupAnimation.FADE);
                });

                settingsItem.visible = Main.sessionMode.allowSettings;
                this.menu._settingsActions[extension.uuid] = settingsItem;
            } catch (error) {
                extension.getLogger().error(`Error in SmartAutoMoveNGMenuToggle constructor: ${error}`);
            }
        }

        setMenuTitleAndHeader(savedWindowsCount, overridesCount) {
            const stats = `${savedWindowsCount} ${_("Saved Windows")}-${overridesCount} ${_("Overrides")}`;
            this.set({
                subtitle: stats,
            });
            this.menu.setHeader(this.gicon, "Smart Auto Move NG", stats);
        }

        bindToggleToSetting(_settings) {
            const usageEnumValue = _settings.get_enum(Common.SETTINGS_KEY_QUICKSETTINGSTOGGLE);
            let quicksettingstogglekey;
            switch (usageEnumValue) {
                case 0:
                    quicksettingstogglekey = Common.SETTINGS_KEY_FREEZE_SAVES;
                    break;
                case 1:
                    quicksettingstogglekey = Common.SETTINGS_KEY_ACTIVATE_WORKSPACE;
                    break;
                case 2:
                    quicksettingstogglekey = Common.SETTINGS_KEY_IGNORE_POSITION;
                    break;
                case 3:
                    quicksettingstogglekey = Common.SETTINGS_KEY_IGNORE_WORKSPACE;
                    break;
                case 4:
                    quicksettingstogglekey = Common.SETTINGS_KEY_IGNORE_MONITOR;
                    break;
                default:
                    // Fallback to a known value
                    quicksettingstogglekey = Common.SETTINGS_KEY_FREEZE_SAVES;
                    break;
            }
            _settings.bind(quicksettingstogglekey, this, "checked", Gio.SettingsBindFlags.DEFAULT);
        }
    }
);

const SmartAutoMoveNGIndicator = GObject.registerClass(
    class SmartAutoMoveNGIndicator extends QuickSettings.SystemIndicator {
        constructor(extension) {
            super();

            // Create the toggle menu and associate it with the indicator, being
            // sure to destroy it along with the indicator
            this._smartAutoMoveNGMenuToggle = new SmartAutoMoveNGMenuToggle(extension);
            this.quickSettingsItems.push(this._smartAutoMoveNGMenuToggle);

            this.connect("destroy", () => {
                for (const item of this.quickSettingsItems) {
                    item.destroy();
                }
            });

            // Add the indicator to the panel and the toggle to the menu
            QuickSettingsMenu._indicators.add_child(this);
            QuickSettingsMenu.addExternalIndicator(this);
        }

        get menuToggle() {
            return this._smartAutoMoveNGMenuToggle;
        }
    }
);

//// EXTENSION CLASS
export default class SmartAutoMoveNG extends Extension {
    enable() {
        this._injectionManager = new InjectionManager();
        this._injectionManager.overrideMethod(Main.wm._workspaceTracker, "_checkWorkspaces", (originalMethod) =>
            this._getCheckWorkspaceOverride(originalMethod)
        );

        this._activeWindows = new Map();
        this._trackedWindows = new Map();
        this._settings = this.getSettings();
        this._indicator = null; // Quick Settings indicator see _onParamChangedUI
        this._finalMenuIcon = this._getMenuIcon();
        this._overrides = {};
        this._savedWindows = {};
        this._onParamChangedDebugLogging();

        this._debug("enable()");
        this._restoreSettings();

        // Sync windows which might already be open before enabling the extension.
        this._syncWindows().catch((error) => {
            this.getLogger().error(`enable() failed: ${error}`);
        });

        this._timeoutSaveSignal = null;
        this._handleTimeoutSave();
        this._timeoutMoveWindowSignal = null;

        this._settingSignals = [];
        this._savedWindowsCount = 0;
        this._overridesCount = 0;
        this._updateStats();

        const signalMap = [
            [Common.SETTINGS_KEY_DEBUG_LOGGING, this._onParamChangedDebugLogging.bind(this)],
            [Common.SETTINGS_KEY_QUICKSETTINGS, this._onParamChangedUI.bind(this)],
            [Common.SETTINGS_KEY_QUICKSETTINGSTOGGLE, this._onParamChangedUI.bind(this)],
            [Common.SETTINGS_KEY_NOTIFICATIONS, this._onParamChangedUI.bind(this)],
            [Common.SETTINGS_KEY_STARTUP_DELAY, this._onParamChangedStartupDelay.bind(this)],
            [Common.SETTINGS_KEY_SAVE_FREQUENCY, this._onParamChangedSaveFrequency.bind(this)],
            [Common.SETTINGS_KEY_MATCH_THRESHOLD, this._onParamChangedMatchThreshold.bind(this)],
            [Common.SETTINGS_KEY_SYNC_MODE, this._onParamChangedSyncMode.bind(this)],
            [Common.SETTINGS_KEY_FREEZE_SAVES, this._onParamChangedFreezeSaves.bind(this)],
            [Common.SETTINGS_KEY_ACTIVATE_WORKSPACE, this._onParamChangedActivateWorkspace.bind(this)],
            [Common.SETTINGS_KEY_IGNORE_POSITION, this._onParamChangedIgnorePosition.bind(this)],
            [Common.SETTINGS_KEY_IGNORE_WORKSPACE, this._onParamChangedIgnoreWorkspace.bind(this)],
            [Common.SETTINGS_KEY_OVERRIDES, this._onParamChangedOverrides.bind(this)],
            [Common.SETTINGS_KEY_SAVED_WINDOWS, this._onParamChangedSavedWindows.bind(this)],
            [Common.SETTINGS_KEY_IGNORE_MONITOR, this._onParamChangedIgnoreMonitor.bind(this)],
        ];
        for (const [key, handler] of signalMap) {
            const id = this._settings.connect("changed::" + key, handler);
            this._settingSignals.push(id);
        }
        this._pendingWindows = new Map();
        this._pendingWindowSignals = new Map();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._startupSequenceChangedSignal = null;
        // new method over window-created signal
        this._windowCreatedSignal = global.display.connect("window-created", (_display, window) => {
            const mappedId = window.connect("notify::mapped", (metaWindow) => {
                metaWindow.disconnect(mappedId);
                // check for pending
                if (this._checkForPendingWindows(metaWindow)) {
                    this._debug(
                        `window-created handler: window ${this._windowTitle(metaWindow)} is still pending, skipping for now`
                    );
                    return;
                }
                // end check for pending
                this._syncWindow(window).catch((error) => {
                    this.getLogger().error(`window-created handler failed: ${error}`);
                });
            });
        });
    }

    disable() {
        this._debug("disable()");
        this._injectionManager.clear();
        this._injectionManager = null;

        if (this._windowCreatedSignal !== null) global.display.disconnect(this._windowCreatedSignal);
        this._windowCreatedSignal = null;
        for (const [window, ids] of this._trackedWindows.entries()) {
            if (window) {
                window.disconnect(ids.unmanagedId);
                window.disconnect(ids.sizechangeId);
                window.disconnect(ids.moveId);
                window.disconnect(ids.titlechangeId);
            }
        }
        this._trackedWindows.clear();
        this._trackedWindows = null;
        //remove timeout signals
        if (this._timeoutSaveSignal !== null) GLib.Source.remove(this._timeoutSaveSignal);
        this._timeoutSaveSignal = null;
        if (this._timeoutMoveWindowSignal !== null) GLib.Source.remove(this._timeoutMoveWindowSignal);
        this._timeoutMoveWindowSignal = null;
        // remove setting Signals
        if (this._settingSignals) {
            for (const signal of this._settingSignals) {
                this._settings.disconnect(signal);
            }
        }
        this._settingSignals = null;
        this._savedWindowsCount = null;
        this._overridesCount = null;
        this._finalMenuIcon = null;

        this._saveSettings();
        this._cleanupSettings();
        this._activeWindows = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._isGnome49OrHigher = null;
    }

    _cleanupWindowSignals() {
        if (this._windowCreatedSignal !== null) global.display.disconnect(this._windowCreatedSignal);
        for (const [window, ids] of this._trackedWindows.entries()) {
            if (window) {
                if (ids.provisionalTimeoutId !== null) {
                    GLib.Source.remove(ids.provisionalTimeoutId);
                }
                window.disconnect(ids.unmanagedId);
                window.disconnect(ids.sizechangeId);
                window.disconnect(ids.moveId);
                window.disconnect(ids.titlechangeId);
            }
        }
        for (const windows of this._pendingWindows.values()) {
            for (const win of windows) {
                const signals = this._pendingWindowSignals.get(win);
                if (signals && signals.unmanagedId !== null) {
                    win.disconnect(signals.unmanagedId);
                }
                if (signals && signals.timeoutId !== null) {
                    GLib.Source.remove(signals.timeoutId);
                }
            }
        }
    }

    _checkForPendingWindows(win) {
        const wmClass = win.get_wm_class();
        const sequences = this._windowTracker.get_startup_sequences();

        // Check for peding windows with matching wmClass - seems to be the only way to detect windows which are still in the startup phase and not fully initialized yet (e.g. Firefox) and would otherwise be missed by the window-created signal - without this check, these windows would not be tracked and thus not restored on next open
        const isAppLoading = sequences.some((seq) => !seq.get_completed() && seq.get_wmclass() === wmClass);
        if (isAppLoading) {
            this._debug(`App ${wmClass} is loading, adding to pending windows`);

            let pendingWindows = this._pendingWindows.get(wmClass);
            if (!pendingWindows) {
                pendingWindows = new Set();
                this._pendingWindows.set(wmClass, pendingWindows);
            }
            pendingWindows.add(win);

            if (!this._pendingWindowSignals.has(win)) {
                const signals = {
                    unmanagedId: null,
                    timeoutId: null,
                };
                signals.unmanagedId = win.connect("unmanaged", () => {
                    signals.unmanagedId = null;
                    this._removePendingWindow(wmClass, win);
                });
                signals.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15000, () => {
                    signals.timeoutId = null;
                    this._removePendingWindow(wmClass, win);
                    this._debug(`Startup completion timed out for ${wmClass}. Moving pending window.`);
                    this._syncWindow(win).catch((error) => {
                        this.getLogger().error(`pending window timeout handler failed: ${error}`);
                    });
                    return GLib.SOURCE_REMOVE;
                });
                this._pendingWindowSignals.set(win, signals);
            }

            // If we do not listen to the sequence-completed signal of the startup notification tracker, we would not be able to detect when the app has finished loading and thus would not know when to try to restore the window - by listening to the signal, we can trigger a restore attempt as soon as the app has finished loading, which seems to be more reliable than using timeouts or other heuristics
            if (this._startupSequenceChangedSignal === null) {
                this._startupSequenceChangedSignal = this._windowTracker.connect(
                    "startup-sequence-changed",
                    (_tracker, sequence) => {
                        if (sequence.get_completed()) {
                            this._onStartupSequenceCompleted(sequence);
                        }
                    }
                );
            }
            return true;
        } else {
            // No startup sequence for this window, try to move it directly - seems to be necessary to properly track windows which are opened by already running applications (e.g. new terminal windows) which do not have a startup sequence and would otherwise be missed by the window-created signal - without this check, these windows would not be tracked and thus not restored on next open
            return false;
        }
    }

    _onStartupSequenceCompleted(sequence) {
        const wmClass = sequence.get_wmclass();

        // Check if we have a pending window for this wmClass - seems to be necessary to properly detect when the app has finished loading and thus know when to try to restore the window - by checking for pending windows with matching wmClass, we can trigger a restore attempt as soon as the app has finished loading, which seems to be more reliable than using timeouts or other heuristics
        if (this._pendingWindows.has(wmClass)) {
            const pendingWindows = this._pendingWindows.get(wmClass);

            this._debug(`Loading for ${wmClass} officially completed. Moving pending windows.`);
            for (const win of pendingWindows) {
                this._removePendingWindow(wmClass, win);
                this._syncWindow(win).catch((error) => {
                    this.getLogger().error(`window-created handler failed: ${error}`);
                });
            }
        }

        // If no windows are waiting for loading, clean up the global Tracker signal immediately to avoid unnecessary signal handling and potential memory leaks - by disconnecting the signal as soon as we know that no more windows are waiting for loading, we can ensure that we do not keep unnecessary references to the tracker or the signal handler, which could lead to memory leaks or other issues
        this._disconnectStartupTrackerIfIdle();
    }

    _removePendingWindow(wmClass, win) {
        const pendingWindows = this._pendingWindows?.get(wmClass);
        if (pendingWindows) {
            pendingWindows.delete(win);
            if (pendingWindows.size === 0) {
                this._pendingWindows.delete(wmClass);
            }
        }

        const signals = this._pendingWindowSignals?.get(win);
        if (signals) {
            if (signals.unmanagedId !== null) {
                win.disconnect(signals.unmanagedId);
            }
            if (signals.timeoutId !== null) {
                GLib.Source.remove(signals.timeoutId);
            }
            this._pendingWindowSignals.delete(win);
        }

        this._disconnectStartupTrackerIfIdle();
    }

    _disconnectStartupTrackerIfIdle() {
        if (this._pendingWindows?.size === 0 && this._startupSequenceChangedSignal !== null) {
            this._windowTracker.disconnect(this._startupSequenceChangedSignal);
            this._startupSequenceChangedSignal = null;
        }
    }

    _getCheckWorkspaceOverride(originalMethod) {
        /* eslint-disable no-invalid-this */
        return function () {
            const keepAliveWorkspaces = [];
            let foundNonEmpty = false;
            for (let i = this._workspaces.length - 1; i >= 0; i--) {
                if (!foundNonEmpty) {
                    foundNonEmpty = this._workspaces[i].list_windows().some((w) => !w.is_on_all_workspaces());
                } else if (!this._workspaces[i]._keepAliveId) {
                    keepAliveWorkspaces.push(this._workspaces[i]);
                }
            }

            // make sure the original method only removes empty workspaces at the end
            keepAliveWorkspaces.forEach((ws) => (ws._keepAliveId = 1));
            try {
                return originalMethod.call(this);
            } finally {
                keepAliveWorkspaces.forEach((ws) => delete ws._keepAliveId);
            }
        };
        /* eslint-enable no-invalid-this */
    }

    _getMenuIcon() {
        const SmartAutoMoveNGIcon = "smartautomoveng-symbolic";
        const iconTheme = new St.IconTheme();
        if (iconTheme.has_icon(SmartAutoMoveNGIcon)) {
            return Gio.icon_new_for_string(SmartAutoMoveNGIcon);
        } else {
            const iconPath = "/icons/";
            return Gio.icon_new_for_string(`${this.path}${iconPath}${SmartAutoMoveNGIcon}.svg`);
        }
    }

    //// DEBUG UTILITIES

    _debug(message) {
        if (this._debugLogging) {
            this.getLogger().log(message);
        }
    }

    _dumpSavedWindows() {
        for (const wsh of Object.keys(this._savedWindows)) {
            const sws = this._savedWindows[wsh];
            this._debug("_dumpSavedwindows(): " + wsh + " " + JSON.stringify(sws));
        }
    }

    _dumpCurrentWindows() {
        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            this._dumpWindow(win);
        }
    }

    _dumpWindow(win) {
        this._debug("_dumpWindow(): " + this._windowRepr(win));
    }

    _dumpState() {
        this._dumpSavedWindows();
        this._dumpCurrentWindows();
    }

    //// SETTINGS
    _cleanupSettings() {
        this._settings = null;
        this._debugLogging = null;
        this._quickSettings = null;
        this._notifications = null;
        this._startupDelayMs = null;
        this._saveFrequencyMs = null;
        this._matchThreshold = null;
        this._syncMode = null;
        this._freezeSaves = null;
        this._activateWorkspace = null;
        this._ignorePosition = null;
        this._ignoreWorkspace = null;
        this._overrides = null;
        this._savedWindows = null;
    }

    _restoreSettings() {
        this._debug("_restoreSettings()");
        this._onParamChangedDebugLogging();
        this._onParamChangedStartupDelay();
        this._onParamChangedSaveFrequency();
        this._onParamChangedMatchThreshold();
        this._onParamChangedSyncMode();
        this._onParamChangedFreezeSaves();
        this._onParamChangedActivateWorkspace();
        this._onParamChangedIgnorePosition();
        this._onParamChangedIgnoreWorkspace();
        this._onParamChangedOverrides();
        this._onParamChangedSavedWindows();
        this._onParamChangedIgnoreMonitor();
        this._dumpSavedWindows();
        // Update the UI to reflect the restored settings - has to be last to not show notifications too early
        this._onParamChangedUI();
    }

    _saveSettings() {
        const newOverrides = JSON.stringify(this._overrides);
        this._settings.set_string(Common.SETTINGS_KEY_OVERRIDES, newOverrides);

        const oldSavedWindows = this._settings.get_string(Common.SETTINGS_KEY_SAVED_WINDOWS);
        const newSavedWindows = JSON.stringify(this._savedWindows);
        if (oldSavedWindows === newSavedWindows) return;
        this._debug("_saveSettings()");
        this._dumpSavedWindows();
        this._settings.set_string(Common.SETTINGS_KEY_SAVED_WINDOWS, newSavedWindows);
    }

    //// WINDOW UTILITIES

    _trackWindow(win) {
        if (this._trackedWindows.has(win)) return;

        const windowHash = this._windowHash(win);
        this._activeWindows.set(windowHash, Date.now());

        const signals = {
            unmanagedId: null,
            sizechangeId: null,
            moveId: null,
            titlechangeId: null,
            provisionalTimeoutId: null,
        };

        signals.unmanagedId = win.connect("unmanaged", () => {
            if (signals.provisionalTimeoutId !== null) {
                GLib.Source.remove(signals.provisionalTimeoutId);
                signals.provisionalTimeoutId = null;
            }
            this._activeWindows.delete(windowHash);
            this._trackedWindows.delete(win);
            // Windows closed during the provisional period never update their saved geometry.
            this._cleanupWindows();
        });
        signals.sizechangeId = win.connect("size-changed", () => {
            // update saved window data when window changes size - prevents wrong restore size on next open
            this._ensureSavedWindow(win);
        });
        signals.moveId = win.connect("position-changed", () => {
            // update saved window data when window changes position - prevents wrong restore position on next open
            this._ensureSavedWindow(win);
        });
        signals.titlechangeId = win.connect("notify::title", () => {
            // update saved window data when window changes title - allows to find the window again if it was opened with a generic title and only gets its real title later (e.g. terminals)
            this._ensureSavedWindow(win);
        });
        signals.provisionalTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            Math.max(1, this._startupDelayMs + 1),
            () => {
                signals.provisionalTimeoutId = null;
                this._ensureSavedWindow(win);
                return GLib.SOURCE_REMOVE;
            }
        );
        this._trackedWindows.set(win, signals);
    }

    _windowTitle(win) {
        return win.get_title();
    }

    _windowReady(win) {
        const windowReady_win = win && !win.minimized && win.mapped; // is_hidden is true when opened on another workspace - follow ws does not work then
        const win_rect = win.get_frame_rect();
        const windowReady_rect = win_rect.width > 50 && win_rect.height > 50;
        this._debug(`_windowReady() ${this._windowTitle(win)} - rect: ${windowReady_rect} - win: ${windowReady_win}`);
        return windowReady_win && windowReady_rect;
    }

    // https://mutter.gnome.org/meta/class.Window.html
    _windowData(win) {
        const win_rect = win.get_frame_rect();
        return {
            id: win.get_id(),
            hash: this._windowHash(win),
            sequence: win.get_stable_sequence(),
            title: this._windowTitle(win),
            //sandboxed_app_id: win.get_sandboxed_app_id(),
            //pid: win.get_pid(),
            //user_time: win.get_user_time(),
            workspace: win.get_workspace().index(),
            // maximized: For GNOME 49+, only boolean is available. For older, bitmask.
            maximized: win.is_maximized(),
            fullscreen: win.is_fullscreen(),
            above: win.is_above(),
            monitor: win.get_monitor(),
            on_all_workspaces: win.is_on_all_workspaces(),
            x: win_rect.x,
            y: win_rect.y,
            width: win_rect.width,
            height: win_rect.height,
            occupied: true,
        };
    }

    _windowRepr(win) {
        return JSON.stringify(this._windowData(win));
    }

    _windowSectionHash(win) {
        return win.get_wm_class();
    }

    _windowHash(win) {
        return win.get_id();
    }

    _windowDataEqual(sw1, sw2) {
        return JSON.stringify(sw1) === JSON.stringify(sw2);
    }

    _windowNewerThan(win, age) {
        if (this._activeWindows === null) return false;
        const wh = this._windowHash(win);

        if (this._activeWindows.get(wh) === undefined) {
            this._activeWindows.set(wh, Date.now());
        }

        return Date.now() - this._activeWindows.get(wh) < age;
    }

    //// WINDOW SAVE / RESTORE

    _pushSavedWindow(win) {
        const wsh = this._windowSectionHash(win);
        if (wsh === null) return false;
        if (!Object.hasOwn(this._savedWindows, wsh)) this._savedWindows[wsh] = [];
        const sw = this._windowData(win);
        this._savedWindows[wsh].push(sw);
        this._debug("_pushSavedWindow() - pushed: " + JSON.stringify(sw));
        return true;
    }

    _updateSavedWindow(win) {
        const wsh = this._windowSectionHash(win);
        const [swi] = Common.findSavedWindow(this._savedWindows, wsh, { hash: this._windowHash(win) }, 1);
        if (swi === undefined) return false;
        const sw = this._windowData(win);
        if (this._windowDataEqual(this._savedWindows[wsh][swi], sw)) return true;
        this._savedWindows[wsh][swi] = sw;
        this._debug("_updateSavedWindow() - updated: " + swi + ", " + JSON.stringify(sw));
        return true;
    }

    _occupySavedWindow(win, swi) {
        const wsh = this._windowSectionHash(win);
        const sw = this._savedWindows[wsh][swi];
        const current = this._windowData(win);

        sw.id = current.id;
        sw.hash = current.hash;
        sw.sequence = current.sequence;
        sw.title = current.title;
        sw.occupied = true;
    }

    _ensureSavedWindow(win) {
        if (this._windowNewerThan(win, this._startupDelayMs)) return;

        if (this._freezeSaves) return;

        if (!this._updateSavedWindow(win)) {
            this._pushSavedWindow(win);
        }
    }

    _findOverrideAction(win, threshold) {
        const wsh = this._windowSectionHash(win);
        const sw = this._windowData(win);

        let action = this._syncMode;

        const override = Common.findOverride(this._overrides, wsh, sw, threshold);

        if (override?.action !== undefined) action = override.action;

        return action;
    }

    _moveWindowToMonitor(win, monitor) {
        // global.display.get_n_monitors() is count of monitors, monitor is zero-based index
        if (global.display.get_n_monitors() > monitor) {
            win.move_to_monitor(monitor);
            this._debug("_moveWindow to monitor: " + monitor);
        }
    }

    _moveWindowToWorkspace(win, workspace, on_all_workspaces) {
        if (on_all_workspaces) {
            win.stick();
            this._debug("_moveWindow to workspace: all workspaces");
        } else {
            const workspaceManager = global.workspace_manager;
            // ensure we have the required number of workspaces
            for (let i = workspaceManager.n_workspaces; i <= workspace; i++) {
                win.change_workspace_by_index(i - 1, false);
                workspaceManager.append_new_workspace(false, 0);
            }
            win.change_workspace_by_index(workspace, false);
            this._debug("_moveWindow to workspace: " + workspace);
            const ws = workspaceManager.get_workspace_by_index(workspace);
            if (this._activateWorkspace && !ws.active) ws.activate(true);
        }
    }

    async _moveWindow(win, sw) {
        if (!this._ignoreMonitor) {
            this._moveWindowToMonitor(win, sw.monitor);
        }
        if (!this._ignoreWorkspace) {
            this._moveWindowToWorkspace(win, sw.workspace, sw.on_all_workspaces);
        }
        let targetX = sw.x;
        let targetY = sw.y;
        if (this._ignorePosition) {
            const cw = this._windowData(win);
            targetX = cw.x;
            targetY = cw.y;
        }
        win.move_resize_frame(false, targetX, targetY, sw.width, sw.height);
        if (sw.maximized) win.maximize(sw.maximized);
        // NOTE: these additional move/maximize operations were needed in order to convince Firefox to stay where we put it.
        win.move_resize_frame(false, targetX, targetY, sw.width, sw.height);
        if (sw.maximized) win.maximize(sw.maximized);
        win.move_resize_frame(false, targetX, targetY, sw.width, sw.height);

        if (sw.fullscreen) win.make_fullscreen();

        if (sw.above) win.make_above();
        // give the window 500ms to react to the move/resize and update its state
        await new Promise((resolve) => {
            if (this._timeoutMoveWindowSignal !== null) GLib.Source.remove(this._timeoutMoveWindowSignal);
            this._timeoutMoveWindowSignal = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });

        const nsw = this._windowData(win);

        return nsw;
    }

    async _restoreWindow(win) {
        const wsh = this._windowSectionHash(win);

        // 'sw' is assigned once from matchedWindow and never reassigned

        let [swi] = Common.findSavedWindow(this._savedWindows, wsh, { hash: this._windowHash(win), occupied: true }, 1);

        if (swi !== undefined) return false;

        if (!this._windowReady(win)) return true; // try again later

        const [swiNew, sw] = Common.matchedWindow(
            this._savedWindows,
            this._overrides,
            wsh,
            this._windowTitle(win),
            this._matchThreshold
        );
        swi = swiNew;

        if (swi === undefined) return false;

        if (this._windowDataEqual(sw, this._windowData(win))) return true;

        const action = this._findOverrideAction(win, 1);
        if (action !== Common.SYNC_MODE_RESTORE) return true;

        // Claim the matched slot without teaching it geometry from a provisional startup window.
        this._occupySavedWindow(win, swi);

        const pWinRepr = this._windowRepr(win);
        const retryCount = 5; // give the window more chances to be in the correct state before giving up - seems to help Firefox
        let nsw;
        for (let i = 0; i < retryCount; i++) {
            nsw = await this._moveWindow(win, sw);

            if (this._ignorePosition || (sw.x === nsw.x && sw.y === nsw.y)) {
                const attemptText = i > 0 ? " (attempt " + (i + 1) + ")" : "";
                this.getLogger().log(
                    `Position match after move${attemptText}: expected (${sw.x}, ${sw.y}), got (${nsw.x}, ${nsw.y}) for window ${pWinRepr}`
                );
                this._trackWindow(win);
                this._ensureSavedWindow(win);
                break;
            } else {
                this.getLogger().warn(
                    `Position mismatch after move: expected (${sw.x}, ${sw.y}), got (${nsw.x}, ${nsw.y}) for window ${pWinRepr}`
                );
            }

            // if (!this._activateWorkspace) return true;
        }

        this._debug("restoreWindow() - moved: " + pWinRepr + " => " + JSON.stringify(nsw));

        return true;
    }

    _cleanupWindows() {
        const found = new Map();

        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            found.set(this._windowHash(win), true);
        }

        for (const wsh of Object.keys(this._savedWindows)) {
            const sws = this._savedWindows[wsh];
            for (const sw of sws) {
                if (sw.occupied && !found.has(sw.hash)) {
                    sw.occupied = false;
                    this._debug("_cleanupWindows() - deoccupy: " + JSON.stringify(sw));
                }
            }
        }
    }

    _shouldSkipWindow(win) {
        const shouldSkip = win.is_skip_taskbar() || win.get_window_type() !== Meta.WindowType.NORMAL;
        this._debug(`_shouldSkipWindow() ${this._windowTitle(win)} - skip: ${shouldSkip}`);
        return shouldSkip;
    }

    async _syncWindows() {
        this._cleanupWindows();
        const windows = [];

        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            windows.push(win);
        }

        const processWindow = async (index) => {
            if (index >= windows.length) return;
            const win = windows[index];
            await this._syncWindow(win);
            await processWindow(index + 1);
        };

        await processWindow(0);
    }

    async _syncWindow(win) {
        if (this._shouldSkipWindow(win)) return;
        const restored = await this._restoreWindow(win);
        this._trackWindow(win);
        if (!restored) this._ensureSavedWindow(win);
    }

    //// SIGNAL HANDLERS

    _handleTimeoutSave() {
        if (this._timeoutSaveSignal !== null) GLib.Source.remove(this._timeoutSaveSignal);
        this._timeoutSaveSignal = null;
        this._saveSettings();
        this._timeoutSaveSignal = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._saveFrequencyMs,
            this._handleTimeoutSave.bind(this)
        );
        return GLib.SOURCE_CONTINUE;
    }

    _onParamChangedDebugLogging() {
        this._debugLogging = this._settings.get_boolean(Common.SETTINGS_KEY_DEBUG_LOGGING);
        this.getLogger().log("_onParamChangedDebugLogging(): " + this._debugLogging);
        this._sendOSDNotification(_("Debug Logging"), this._debugLogging);
    }

    _onParamChangedUI() {
        this._quickSettings = this._settings.get_boolean(Common.SETTINGS_KEY_QUICKSETTINGS);
        if (this._quickSettings && this._indicator === null) {
            this._indicator = new SmartAutoMoveNGIndicator(this);
            this._indicator.menuToggle.setMenuTitleAndHeader(this._savedWindowsCount, this._overridesCount);
        } else if (!this._quickSettings && this._indicator !== null) {
            this._indicator?.destroy();
            this._indicator = null;
        }
        this._debug("_onParamChangedUI() Quick Settings: " + this._quickSettings);
        this._notifications = this._settings.get_boolean(Common.SETTINGS_KEY_NOTIFICATIONS);
        this._debug("_onParamChangedUI() Notifications: " + this._notifications);
        if (this._indicator === null) return;
        Gio.Settings.unbind(this._indicator.menuToggle, "checked");
        this._indicator.menuToggle.bindToggleToSetting(this._settings);
    }

    _onParamChangedStartupDelay() {
        this._startupDelayMs = this._settings.get_int(Common.SETTINGS_KEY_STARTUP_DELAY);
        this._debug("_onParamChangedStartupDelay(): " + this._startupDelayMs);
    }

    _onParamChangedSaveFrequency() {
        this._saveFrequencyMs = this._settings.get_int(Common.SETTINGS_KEY_SAVE_FREQUENCY);
        this._debug("_onParamChangedSaveFrequency(): " + this._saveFrequencyMs);
    }

    _onParamChangedMatchThreshold() {
        this._matchThreshold = this._settings.get_double(Common.SETTINGS_KEY_MATCH_THRESHOLD);
        this._debug("_onParamChangedMatchThreshold(): " + this._matchThreshold);
    }

    _onParamChangedSyncMode() {
        this._syncMode = this._settings.get_enum(Common.SETTINGS_KEY_SYNC_MODE);
        this._debug("_onParamChangedSyncMode(): " + this._syncMode);
    }

    _onParamChangedFreezeSaves() {
        this._freezeSaves = this._settings.get_boolean(Common.SETTINGS_KEY_FREEZE_SAVES);
        this._sendOSDNotification(_("Freeze Saves"), this._freezeSaves);
        this._debug("_onParamChangedFreezeSaves(): " + this._freezeSaves);
    }

    _onParamChangedActivateWorkspace() {
        this._activateWorkspace = this._settings.get_boolean(Common.SETTINGS_KEY_ACTIVATE_WORKSPACE);
        this._debug("_onParamChangedActivateWorkspace(): " + this._activateWorkspace);
        this._sendOSDNotification(_("Activate Workspace"), this._activateWorkspace);
    }

    _onParamChangedIgnorePosition() {
        this._ignorePosition = this._settings.get_boolean(Common.SETTINGS_KEY_IGNORE_POSITION);
        this._debug("_onParamChangedIgnorePosition(): " + this._ignorePosition);
        this._sendOSDNotification(_("Ignore Position"), this._ignorePosition);
    }

    _onParamChangedIgnoreWorkspace() {
        this._ignoreWorkspace = this._settings.get_boolean(Common.SETTINGS_KEY_IGNORE_WORKSPACE);
        this._debug("_onParamChangedIgnoreWorkspace(): " + this._ignoreWorkspace);
        this._sendOSDNotification(_("Ignore Workspace"), this._ignoreWorkspace);
    }

    _updateStats() {
        this._savedWindowsCount = Object.keys(this._savedWindows).length;
        this._overridesCount = Object.keys(this._overrides).length;
    }

    _onParamChangedOverrides() {
        this._overrides = JSON.parse(this._settings.get_string(Common.SETTINGS_KEY_OVERRIDES));
        this._updateStats();
        if (this._quickSettings) {
            this._indicator.menuToggle.setMenuTitleAndHeader(this._savedWindowsCount, this._overridesCount);
        }
        this._debug("_onParamChangedOverrides(): " + JSON.stringify(this._overrides));
    }

    _onParamChangedSavedWindows() {
        this._savedWindows = JSON.parse(this._settings.get_string(Common.SETTINGS_KEY_SAVED_WINDOWS));
        this._updateStats();
        if (this._quickSettings) {
            this._indicator.menuToggle.setMenuTitleAndHeader(this._savedWindowsCount, this._overridesCount);
        }
        this._debug("_onParamChangedSavedWindows(): " + JSON.stringify(this._savedWindows));
    }

    _onParamChangedIgnoreMonitor() {
        this._ignoreMonitor = this._settings.get_boolean(Common.SETTINGS_KEY_IGNORE_MONITOR);
        this._debug("_onParamChangedIgnoreMonitor(): " + this._ignoreMonitor);
        this._sendOSDNotification(_("Ignore Monitor"), this._ignoreMonitor);
    }

    _sendOSDNotification(message, state) {
        if (this._notifications) {
            let messagestate = _("enabled");
            if (!state) {
                messagestate = _("disabled");
            }
            const finalmessage = `${this.metadata.name}\n${message} ${messagestate}`;

            Main.osdWindowManager.showAll(this._finalMenuIcon, finalmessage, null, null);
        }
    }
}
