"use strict";

// imports
import Meta from "gi://Meta";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { PopupAnimation } from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Common from "./lib/common.js";

const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

//quick settings
const SmartAutoMoveNGMenuToggle = GObject.registerClass(
    class SmartAutoMoveNGMenuToggle extends QuickSettings.QuickMenuToggle {
        constructor(Me) {
            const { _settings } = Me;
            super({
                title: "Smart Auto Move NG",
                toggleMode: true,
            });
            // Icon
            const SmartAutoMoveNGIcon = "smartautomoveng-symbolic";
            this._finalMenuIcon = SmartAutoMoveNGIcon;
            this._iconTheme = new St.IconTheme();
            if (!this._iconTheme.has_icon(SmartAutoMoveNGIcon)) {
                const IconPath = "/icons/";
                this._finalMenuIcon = Gio.icon_new_for_string(`${Me.path}${IconPath}${SmartAutoMoveNGIcon}.svg`);
            }
            this.gicon = this._finalMenuIcon;
            this.menu.setHeader(this._finalMenuIcon, "Smart Auto Move NG", "");

            _settings.bind("freeze-saves", this, "checked", Gio.SettingsBindFlags.DEFAULT);
            // Menu item Saved Windows with subnmenu Cleanup Non-occupied Windows
            const popupMenuExpander = new PopupMenu.PopupSubMenuMenuItem(_("Saved Windows"));
            this.menu.addMenuItem(popupMenuExpander);
            const submenu = new PopupMenu.PopupMenuItem(_("Cleanup Non-occupied Windows"));
            submenu.connect("activate", Common.cleanupNonOccupiedWindows.bind(this, _settings));
            popupMenuExpander.menu.addMenuItem(submenu);
            try {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                const settingsItem = this.menu.addAction(_("Settings"), () => Me._openPreferences());

                settingsItem.visible = Main.sessionMode.allowSettings;
                this.menu._settingsActions[Me.uuid] = settingsItem;
            } catch (error) {
                this.getLogger().error(`Error in SmartAutoMoveNGMenuToggle constructor: ${error}`);
            }
        }

        setMenuTitleAndHeader(savedWindowsCount, overridesCount) {
            const stats = `${savedWindowsCount} ${_("Saved Windows")}-${overridesCount} ${_("Overrides")}`;
            this.set({
                subtitle: stats,
            });
            this.menu.setHeader(this._finalMenuIcon, "Smart Auto Move NG", stats);
        }
    }
);

const SmartAutoMoveNGIndicator = GObject.registerClass(
    class SmartAutoMoveNGIndicator extends QuickSettings.SystemIndicator {
        constructor(Me) {
            super();

            // Create the toggle menu and associate it with the indicator, being
            // sure to destroy it along with the indicator
            this._smartAutoMoveNGMenuToggle = new SmartAutoMoveNGMenuToggle(Me);
            this.quickSettingsItems.push(this._smartAutoMoveNGMenuToggle);

            this.connect("destroy", () => {
                this.quickSettingsItems.forEach((item) => item.destroy());
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
        this._activeWindows = new Map();
        this._settings = this.getSettings();
        this._indicator = new SmartAutoMoveNGIndicator(this);
        this._initializeSettings();

        this._debug("enable()");
        this._restoreSettings();
        // timeout sync & save

        this._timeoutSyncSignal = null;
        this._handleTimeoutSync();
        this._timeoutSaveSignal = null;
        this._handleTimeoutSave();

        this._settingSignals = [];
        this._savedWindowsCount = 0;
        this._overridesCount = 0;
        this._updateStats();

        const signalMap = [
            [Common.SETTINGS_KEY_DEBUG_LOGGING, this._handleChangedDebugLogging.bind(this)],
            [Common.SETTINGS_KEY_STARTUP_DELAY, this._handleChangedStartupDelay.bind(this)],
            [Common.SETTINGS_KEY_SYNC_FREQUENCY, this._handleChangedSyncFrequency.bind(this)],
            [Common.SETTINGS_KEY_SAVE_FREQUENCY, this._handleChangedSaveFrequency.bind(this)],
            [Common.SETTINGS_KEY_MATCH_THRESHOLD, this._handleChangedMatchThreshold.bind(this)],
            [Common.SETTINGS_KEY_SYNC_MODE, this._handleChangedSyncMode.bind(this)],
            [Common.SETTINGS_KEY_FREEZE_SAVES, this._handleChangedFreezeSaves.bind(this)],
            [Common.SETTINGS_KEY_ACTIVATE_WORKSPACE, this._handleChangedActivateWorkspace.bind(this)],
            [Common.SETTINGS_KEY_IGNORE_POSITION, this._handleChangedIgnorePosition.bind(this)],
            [Common.SETTINGS_KEY_IGNORE_WORKSPACE, this._handleChangedIgnoreWorkspace.bind(this)],
            [Common.SETTINGS_KEY_OVERRIDES, this._handleChangedOverrides.bind(this)],
            [Common.SETTINGS_KEY_SAVED_WINDOWS, this._handleChangedSavedWindows.bind(this)],
        ];
        for (const [key, handler] of signalMap) {
            const id = this._settings.connect("changed::" + key, handler);
            this._settingSignals.push(id);
        }
    }

    disable() {
        this._debug("disable()");
        //remove timeout signals
        GLib.Source.remove(this._timeoutSyncSignal);
        this._timeoutSyncSignal = null;
        GLib.Source.remove(this._timeoutSaveSignal);
        this._timeoutSaveSignal = null;
        // remove setting Signals
        this._settingSignals.forEach(function (signal) {
            this._settings.disconnect(signal);
        }, this);
        this._settingSignals = null;
        this._savedWindowsCount = null;
        this._overridesCount = null;

        this._saveSettings();
        this._cleanupSettings();
        this._activeWindows = null;
        this._indicator.destroy();
        this._indicator = null;
    }

    _openPreferences() {
        this.openPreferences();
        QuickSettingsMenu.menu.close(PopupAnimation.FADE);
    }

    //// DEBUG UTILITIES

    _debug(message) {
        if (this._debugLogging) {
            this.getLogger().log(message);
        }
    }

    _dumpSavedWindows() {
        Object.keys(this._savedWindows).forEach((wsh) => {
            let sws = this._savedWindows[wsh];
            this._debug("_dumpSavedwindows(): " + wsh + " " + JSON.stringify(sws));
        });
    }

    _dumpCurrentWindows() {
        global.get_window_actors().forEach((actor) => {
            let win = actor.get_meta_window();
            this._dumpWindow(win);
        });
    }

    _dumpWindow(win) {
        this._debug("_dumpWindow(): " + this._windowRepr(win));
    }

    _dumpState() {
        this._dumpSavedWindows();
        this._dumpCurrentWindows();
    }

    //// SETTINGS

    _initializeSettings() {
        this._debugLogging = Common.DEFAULT_DEBUG_LOGGING;
        this._startupDelayMs = Common.DEFAULT_STARTUP_DELAY_MS;
        this._syncFrequencyMs = Common.DEFAULT_SYNC_FREQUENCY_MS;
        this._saveFrequencyMs = Common.DEFAULT_SAVE_FREQUENCY_MS;
        this._matchThreshold = Common.DEFAULT_MATCH_THRESHOLD;
        this._syncMode = Common.DEFAULT_SYNC_MODE;
        this._freezeSaves = Common.DEFAULT_FREEZE_SAVES;
        this._activateWorkspace = Common.DEFAULT_ACTIVATE_WORKSPACE;
        this._ignorePosition = Common.DEFAULT_IGNORE_POSITION;
        this._ignoreWorkspace = Common.DEFAULT_IGNORE_WORKSPACE;
        this._overrides = {};
        this._savedWindows = {};
        this._handleChangedDebugLogging();
    }

    _cleanupSettings() {
        this._settings = null;
        this._debugLogging = null;
        this._startupDelayMs = null;
        this._syncFrequencyMs = null;
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
        this._handleChangedDebugLogging();
        this._handleChangedStartupDelay();
        this._handleChangedSyncFrequency();
        this._handleChangedSaveFrequency();
        this._handleChangedMatchThreshold();
        this._handleChangedSyncMode();
        this._handleChangedFreezeSaves();
        this._handleChangedActivateWorkspace();
        this._handleChangedIgnorePosition();
        this._handleChangedIgnoreWorkspace();
        this._handleChangedOverrides();
        this._handleChangedSavedWindows();
        this._dumpSavedWindows();
    }

    _saveSettings() {
        this._settings.set_boolean(Common.SETTINGS_KEY_DEBUG_LOGGING, this._debugLogging);
        this._settings.set_int(Common.SETTINGS_KEY_STARTUP_DELAY, this._startupDelayMs);
        this._settings.set_int(Common.SETTINGS_KEY_SYNC_FREQUENCY, this._syncFrequencyMs);
        this._settings.set_int(Common.SETTINGS_KEY_SAVE_FREQUENCY, this._saveFrequencyMs);
        this._settings.set_double(Common.SETTINGS_KEY_MATCH_THRESHOLD, this._matchThreshold);
        this._settings.set_enum(Common.SETTINGS_KEY_SYNC_MODE, this._syncMode);
        this._settings.set_boolean(Common.SETTINGS_KEY_FREEZE_SAVES, this._freezeSaves);
        this._settings.set_boolean(Common.SETTINGS_KEY_ACTIVATE_WORKSPACE, this._activateWorkspace);
        this._settings.set_boolean(Common.SETTINGS_KEY_IGNORE_POSITION, this._ignorePosition);
        this._settings.set_boolean(Common.SETTINGS_KEY_IGNORE_WORKSPACE, this._ignoreWorkspace);

        let newOverrides = JSON.stringify(this._overrides);
        this._settings.set_string(Common.SETTINGS_KEY_OVERRIDES, newOverrides);

        let oldSavedWindows = this._settings.get_string(Common.SETTINGS_KEY_SAVED_WINDOWS);
        let newSavedWindows = JSON.stringify(this._savedWindows);
        if (oldSavedWindows === newSavedWindows) return;
        this._debug("_saveSettings()");
        this._dumpSavedWindows();
        this._settings.set_string(Common.SETTINGS_KEY_SAVED_WINDOWS, newSavedWindows);
    }

    //// WINDOW UTILITIES

    _windowReady(win) {
        let win_rect = win.get_frame_rect();
        return !(win_rect.width === 0 && win_rect.height === 0) && !(win_rect.x === 0 && win_rect.y === 0);
    }

    // https://gjs-docs-experimental.web.app/meta-10/Window/
    _windowData(win) {
        let win_rect = win.get_frame_rect();
        return {
            id: win.get_id(),
            hash: this._windowHash(win),
            sequence: win.get_stable_sequence(),
            title: win.get_title(),
            //sandboxed_app_id: win.get_sandboxed_app_id(),
            //pid: win.get_pid(),
            //user_time: win.get_user_time(),
            workspace: win.get_workspace().index(),
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
        let wh = this._windowHash(win);

        if (this._activeWindows.get(wh) === undefined) {
            this._activeWindows.set(wh, Date.now());
        }

        return Date.now() - this._activeWindows.get(wh) < age;
    }

    //// WINDOW SAVE / RESTORE

    _pushSavedWindow(win) {
        let wsh = this._windowSectionHash(win);
        if (wsh === null) return false;
        if (!Object.hasOwn(this._savedWindows, wsh)) this._savedWindows[wsh] = [];
        let sw = this._windowData(win);
        this._savedWindows[wsh].push(sw);
        this._debug("_pushSavedWindow() - pushed: " + JSON.stringify(sw));
        return true;
    }

    _updateSavedWindow(win) {
        let wsh = this._windowSectionHash(win);
        let [swi] = Common.findSavedWindow(this._savedWindows, wsh, { hash: this._windowHash(win) }, 1.0);
        if (swi === undefined) return false;
        let sw = this._windowData(win);
        if (this._windowDataEqual(this._savedWindows[wsh][swi], sw)) return true;
        this._savedWindows[wsh][swi] = sw;
        this._debug("_updateSavedWindow() - updated: " + swi + ", " + JSON.stringify(sw));
        return true;
    }

    _ensureSavedWindow(win) {
        if (this._windowNewerThan(win, this._startupDelayMs)) return;

        if (this._freezeSaves) return;

        if (!this._updateSavedWindow(win)) {
            this._pushSavedWindow(win);
        }
    }

    _findOverrideAction(win, threshold) {
        let wsh = this._windowSectionHash(win);
        let sw = this._windowData(win);

        let action = this._syncMode;

        let override = Common.findOverride(this._overrides, wsh, sw, threshold);

        if (override !== undefined && override.action !== undefined) action = override.action;

        return action;
    }

    _moveWindow(win, sw) {
        win.move_to_monitor(sw.monitor);

        let ws = global.workspaceManager.get_workspace_by_index(sw.workspace);
        if (!this._ignoreWorkspace) {
            win.change_workspace(ws);
        }

        if (this._ignorePosition) {
            let cw = this._windowData(win);
            sw.x = cw.x;
            sw.y = cw.y;
        }

        win.move_resize_frame(false, sw.x, sw.y, sw.width, sw.height);
        if (sw.maximized) win.maximize(sw.maximized);
        // NOTE: these additional move/maximize operations were needed in order
        // to convince Firefox to stay where we put it.
        win.move_resize_frame(false, sw.x, sw.y, sw.width, sw.height);
        if (sw.maximized) win.maximize(sw.maximized);
        win.move_resize_frame(false, sw.x, sw.y, sw.width, sw.height);

        if (sw.fullscreen) win.make_fullscreen();

        if (sw.above) win.make_above();

        if (this._activateWorkspace && !ws.active && !this._ignoreWorkspace) ws.activate(true);

        if (sw.on_all_workspaces) win.stick();

        let nsw = this._windowData(win);

        return nsw;
    }

    _restoreWindow(win) {
        let wsh = this._windowSectionHash(win);

        let sw;

        let [swi] = Common.findSavedWindow(
            this._savedWindows,
            wsh,
            { hash: this._windowHash(win), occupied: true },
            1.0
        );

        if (swi !== undefined) return false;

        if (!this._windowReady(win)) return true; // try again later

        [swi, sw] = Common.matchedWindow(
            this._savedWindows,
            this._overrides,
            wsh,
            win.get_title(),
            this._matchThreshold
        );

        if (swi === undefined) return false;

        if (this._windowDataEqual(sw, this._windowData(win))) return true;

        let action = this._findOverrideAction(win, 1.0);
        if (action !== Common.SYNC_MODE_RESTORE) return true;

        let pWinRepr = this._windowRepr(win);

        let nsw = this._moveWindow(win, sw);

        if (!this._ignorePosition) {
            if (!(sw.x === nsw.x && sw.y === nsw.y)) return true;
        }

        this._debug("restoreWindow() - moved: " + pWinRepr + " => " + JSON.stringify(nsw));

        this._savedWindows[wsh][swi] = nsw;

        return true;
    }

    _cleanupWindows() {
        let found = new Map();

        global.get_window_actors().forEach((actor) => {
            let win = actor.get_meta_window();
            found.set(this._windowHash(win), true);
        });

        Object.keys(this._savedWindows).forEach((wsh) => {
            let sws = this._savedWindows[wsh];
            sws.forEach((sw) => {
                if (sw.occupied && !found.has(sw.hash)) {
                    sw.occupied = false;
                    this._debug("_cleanupWindows() - deoccupy: " + JSON.stringify(sw));
                }
            });
        });
    }

    _shouldSkipWindow(win) {
        this._debug(
            "_shouldSkipWindow() " + win.get_title() + " " + win.is_skip_taskbar() + " " + win.get_window_type()
        );

        return win.is_skip_taskbar() || win.get_window_type() !== Meta.WindowType.NORMAL;
    }

    _syncWindows() {
        this._cleanupWindows();
        global.get_window_actors().forEach((actor) => {
            let win = actor.get_meta_window();

            if (this._shouldSkipWindow(win)) return;

            if (!this._restoreWindow(win)) this._ensureSavedWindow(win);
        });
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

    _handleTimeoutSync() {
        if (this._timeoutSyncSignal !== null) GLib.Source.remove(this._timeoutSyncSignal);
        this._timeoutSyncSignal = null;
        this._syncWindows();
        this._timeoutSyncSignal = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._syncFrequencyMs,
            this._handleTimeoutSync.bind(this)
        );
        return GLib.SOURCE_CONTINUE;
    }

    _handleChangedDebugLogging() {
        this._debugLogging = this._settings.get_boolean(Common.SETTINGS_KEY_DEBUG_LOGGING);
        this.getLogger().log("handleChangedDebugLogging(): " + this._debugLogging);
    }

    _handleChangedStartupDelay() {
        this._startupDelayMs = this._settings.get_int(Common.SETTINGS_KEY_STARTUP_DELAY);
        this._debug("_handleChangedStartupDelay(): " + this._startupDelayMs);
    }

    _handleChangedSyncFrequency() {
        this._syncFrequencyMs = this._settings.get_int(Common.SETTINGS_KEY_SYNC_FREQUENCY);
        this._debug("_handleChangedSyncFrequency(): " + this._syncFrequencyMs);
    }

    _handleChangedSaveFrequency() {
        this._saveFrequencyMs = this._settings.get_int(Common.SETTINGS_KEY_SAVE_FREQUENCY);
        this._debug("_handleChangedSaveFrequency(): " + this._saveFrequencyMs);
    }

    _handleChangedMatchThreshold() {
        this._matchThreshold = this._settings.get_double(Common.SETTINGS_KEY_MATCH_THRESHOLD);
        this._debug("_handleChangedMatchThreshold(): " + this._matchThreshold);
    }

    _handleChangedSyncMode() {
        this._syncMode = this._settings.get_enum(Common.SETTINGS_KEY_SYNC_MODE);
        this._debug("_handleChangedSyncMode(): " + this._syncMode);
    }

    _handleChangedFreezeSaves() {
        this._freezeSaves = this._settings.get_boolean(Common.SETTINGS_KEY_FREEZE_SAVES);
        this._debug("_handleChangedFreezeSaves(): " + this._freezeSaves);
    }

    _handleChangedActivateWorkspace() {
        this._activateWorkspace = this._settings.get_boolean(Common.SETTINGS_KEY_ACTIVATE_WORKSPACE);
        this._debug("_handleChangedActivateWorkspace(): " + this._activateWorkspace);
    }

    _handleChangedIgnorePosition() {
        this._ignorePosition = this._settings.get_boolean(Common.SETTINGS_KEY_IGNORE_POSITION);
        this._debug("_handleChangedIgnorePosition(): " + this._ignorePosition);
    }

    _handleChangedIgnoreWorkspace() {
        this._ignoreWorkspace = this._settings.get_boolean(Common.SETTINGS_KEY_IGNORE_WORKSPACE);
        this._debug("_handleChangedIgnoreWorkspace(): " + this._ignoreWorkspace);
    }

    _updateStats() {
        this._savedWindowsCount = Object.keys(this._savedWindows).length;
        this._overridesCount = Object.keys(this._overrides).length;
    }

    _handleChangedOverrides() {
        this._overrides = JSON.parse(this._settings.get_string(Common.SETTINGS_KEY_OVERRIDES));
        this._updateStats();
        this._indicator.menuToggle.setMenuTitleAndHeader(this._savedWindowsCount, this._overridesCount);
        this._debug("handleChangedOverrides(): " + JSON.stringify(this._overrides));
    }

    _handleChangedSavedWindows() {
        this._savedWindows = JSON.parse(this._settings.get_string(Common.SETTINGS_KEY_SAVED_WINDOWS));
        this._updateStats();
        this._indicator.menuToggle.setMenuTitleAndHeader(this._savedWindowsCount, this._overridesCount);
        this._debug("handleChangedSavedWindows(): " + JSON.stringify(this._savedWindows));
    }
}
