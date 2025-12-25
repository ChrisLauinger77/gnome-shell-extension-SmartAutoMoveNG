"use strict";
import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import { ExtensionPreferences, gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import * as Common from "./lib/common.js";

const AppChooser = GObject.registerClass(
    class AppChooser extends Adw.Window {
        constructor(params = {}) {
            super(params);
            const adwtoolbarview = new Adw.ToolbarView();
            const adwheaderbar = new Adw.HeaderBar();
            adwtoolbarview.add_top_bar(adwheaderbar);
            this.set_content(adwtoolbarview);

            const searchEntry = new Gtk.SearchEntry({
                placeholder_text: _("Search..."),
                hexpand: true,
            });
            adwheaderbar.set_title_widget(searchEntry);

            const scrolledwindow = new Gtk.ScrolledWindow();
            adwtoolbarview.set_content(scrolledwindow);
            this.listBox = new Gtk.ListBox({
                selection_mode: Gtk.SelectionMode.SINGLE,
            });
            scrolledwindow.set_child(this.listBox);
            this.selectBtn = new Gtk.Button({
                label: _("Select"),
                css_classes: ["suggested-action"],
            });
            this.cancelBtn = new Gtk.Button({ label: _("Cancel") });
            adwheaderbar.pack_start(this.cancelBtn);
            adwheaderbar.pack_end(this.selectBtn);
            const apps = Gio.AppInfo.get_all()
                .filter((app) => app.should_show())
                .sort((a, b) => {
                    const nameA = a.get_display_name().toLowerCase();
                    const nameB = b.get_display_name().toLowerCase();
                    return nameA.localeCompare(nameB);
                });
            for (const app of apps) {
                if (app.should_show() === false) continue;
                const row = new Adw.ActionRow();
                row.title = app.get_display_name();
                row.subtitle = app.get_id();
                row._searchableText = app.get_display_name().toLowerCase() + " " + app.get_name().toLowerCase();
                row.subtitleLines = 1;
                const icon = new Gtk.Image({ gicon: app.get_icon() });
                row.add_prefix(icon);
                this.listBox.append(row);
            }
            const filterFunc = (row) => {
                const filterText = searchEntry.get_text().toLowerCase();
                if (!filterText) return true;
                return row._searchableText.includes(filterText);
            };
            this.listBox.set_filter_func(filterFunc);
            searchEntry.connect("search-changed", () => {
                this.listBox.invalidate_filter();
            });
            this.cancelBtn.connect("clicked", () => {
                this.close();
            });
        }

        showChooser() {
            return new Promise((resolve) => {
                const signalId = this.selectBtn.connect("clicked", () => {
                    this.close();
                    this.selectBtn.disconnect(signalId);
                    const row = this.listBox.get_selected_row();
                    resolve(row);
                });
                this.present();
            });
        }
    }
);

export default class SAMPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.search_enabled = true;
        window.set_default_size(675, 700);
        const builder = new Gtk.Builder();
        builder.add_from_file(this.path + "/ui/prefs-adw.ui");
        const page1 = builder.get_object("smartautomove_page1");
        window.add(page1);
        const page2 = builder.get_object("smartautomove_page2");
        window.add(page2);
        const page3 = builder.get_object("smartautomove_page3");
        window.add(page3);
        const matchthresholdspin = builder.get_object("match-threshold-spin");
        matchthresholdspin.set_climb_rate(0.05);
        matchthresholdspin.set_digits(2);
        matchthresholdspin.set_numeric(true);
        const syncfrequencyspin = builder.get_object("sync-frequency-spin");
        syncfrequencyspin.set_climb_rate(10);
        syncfrequencyspin.set_numeric(true);
        const savefrequencyspin = builder.get_object("save-frequency-spin");
        savefrequencyspin.set_climb_rate(50);
        savefrequencyspin.set_numeric(true);
        const startupdelayspin = builder.get_object("startup-delay-spin");
        startupdelayspin.set_climb_rate(100);
        startupdelayspin.set_numeric(true);
        this._rebuildOverrides = true; // do we need to rebuild the overrides list?
        this._addResetButton(window, this.getSettings());

        this._general(this.getSettings(), builder);
        const savedwindowsRows = [];
        this._savedwindows(this.getSettings(), builder, savedwindowsRows);
        const overridesRows = [];
        this._overrides(this.getSettings(), builder, overridesRows, page3);
    }

    _general(settings, builder) {
        const generalBindings = [
            [Common.SETTINGS_KEY_DEBUG_LOGGING, "debug-logging-switch", "active"],
            [Common.SETTINGS_KEY_QUICKSETTINGS, "quicksettings-switch", "active"],
            [Common.SETTINGS_KEY_QUICKSETTINGSTOGGLE, "quicksettings-combo", "selected"],
            [Common.SETTINGS_KEY_NOTIFICATIONS, "notifications-switch", "active"],
            [Common.SETTINGS_KEY_SYNC_MODE, "sync-mode-combo", "selected"],
            [Common.SETTINGS_KEY_MATCH_THRESHOLD, "match-threshold-spin", "value"],
            [Common.SETTINGS_KEY_SYNC_FREQUENCY, "sync-frequency-spin", "value"],
            [Common.SETTINGS_KEY_SAVE_FREQUENCY, "save-frequency-spin", "value"],
            [Common.SETTINGS_KEY_STARTUP_DELAY, "startup-delay-spin", "value"],
            [Common.SETTINGS_KEY_FREEZE_SAVES, "freeze-saves-switch", "active"],
            [Common.SETTINGS_KEY_ACTIVATE_WORKSPACE, "activate-workspace-switch", "active"],
            [Common.SETTINGS_KEY_IGNORE_POSITION, "ignore-position-switch", "active"],
            [Common.SETTINGS_KEY_IGNORE_WORKSPACE, "ignore-workspace-switch", "active"],
            [Common.SETTINGS_KEY_IGNORE_MONITOR, "ignore-monitor-switch", "active"],
        ];

        for (const [key, widgetId, property] of generalBindings) {
            const widget = builder.get_object(widgetId);
            if (property === "selected") {
                widget[property] = settings.get_enum(key);

                widget.connect(`notify::${property}`, () => {
                    settings.set_enum(key, widget[property]);
                });

                settings.connect(`changed::${key}`, () => {
                    widget[property] = settings.get_enum(key);
                });
            } else {
                settings.bind(key, widget, property, Gio.SettingsBindFlags.DEFAULT);
            }
        }
    }

    _savedwindows(settings, builder, list_rows) {
        const saved_windows_list_widget = builder.get_object("saved-windows-listbox");
        const saved_windows_list_objects = [];
        const saved_windows_cleanup_widget = builder.get_object("saved-windows-cleanup-button");
        saved_windows_cleanup_widget.connect("activated", () => {
            this._cleanupNonOccupiedWindows(settings);
        });
        this._loadSavedWindowsSetting(settings, saved_windows_list_widget, saved_windows_list_objects, list_rows);
        this.changedSavedWindowsSignal = settings.connect("changed::" + Common.SETTINGS_KEY_SAVED_WINDOWS, () => {
            this._loadSavedWindowsSetting(settings, saved_windows_list_widget, saved_windows_list_objects, list_rows);
        });
    }

    _override(settings, wsh, swtitle) {
        let o = { query: { title: swtitle }, action: 0 };
        let overrides = JSON.parse(settings.get_string(Common.SETTINGS_KEY_OVERRIDES));
        if (!Object.hasOwn(overrides, wsh)) overrides[wsh] = [];
        overrides[wsh].unshift(o);
        settings.set_string(Common.SETTINGS_KEY_OVERRIDES, JSON.stringify(overrides));
    }

    _override_any(settings, wsh) {
        let o = {
            action: 0,
            threshold: settings.get_double(Common.SETTINGS_KEY_MATCH_THRESHOLD),
        };
        let overrides = JSON.parse(settings.get_string(Common.SETTINGS_KEY_OVERRIDES));
        if (!Object.hasOwn(overrides, wsh)) overrides[wsh] = [];
        overrides[wsh].push(o);
        settings.set_string(Common.SETTINGS_KEY_OVERRIDES, JSON.stringify(overrides));
    }

    _overrides(settings, builder, list_rows, page) {
        const overrides_list_objects = [];
        const overrides_list_widget = builder.get_object("overrides-listbox");
        const overrides_add_application_widget = builder.get_object("overrides-add-application-button");
        const myAppChooser = new AppChooser({
            title: _("Select app"),
            modal: true,
            transient_for: page.get_root(),
            hide_on_close: true,
            width_request: 300,
            height_request: 600,
            resizable: false,
        });
        overrides_add_application_widget.connect("activated", async () => {
            const errorLog = (...args) => {
                this.getLogger().error("Error:", ...args);
            };
            const handleError = (error) => {
                errorLog(error);
                return null;
            };
            const appRow = await myAppChooser.showChooser().catch(handleError);
            if (appRow !== null) {
                let wsh = appRow.subtitle.slice(0, -8);
                this._override_any(settings, wsh);
            }
        });
        this._loadOverridesSetting(settings, overrides_list_widget, overrides_list_objects, list_rows);
        this.changedOverridesSignal = settings.connect("changed::" + Common.SETTINGS_KEY_OVERRIDES, () => {
            this._loadOverridesSetting(settings, overrides_list_widget, overrides_list_objects, list_rows);
        });
    }

    _clearListWidget(list_widget, list_objects, list_rows) {
        if (list_rows.length < 1) return;
        for (const element of list_rows) {
            list_widget.remove(element);
            let lo = list_objects.shift();
            if (lo !== null) {
                for (const [signal, widget] of Object.values(lo)) {
                    widget.disconnect(signal);
                }
            }
        }
        list_rows.splice(0, list_rows.length);
    }

    _loadOverridesSetting(settings, list_widget, list_objects, list_rows) {
        if (!this._rebuildOverrides) {
            this._rebuildOverrides = true;
            return;
        }
        const overrides = JSON.parse(settings.get_string(Common.SETTINGS_KEY_OVERRIDES));
        this._clearListWidget(list_widget, list_objects, list_rows);
        for (const wsh of Object.keys(overrides)) {
            const adwexprow = new Adw.ExpanderRow();
            list_rows.push(adwexprow);
            adwexprow.set_title(wsh);
            adwexprow.set_expanded(true);
            list_widget.add(adwexprow);
            list_objects.push(null);

            const wshos = overrides[wsh];
            for (let oi = 0; oi < wshos.length; oi++) {
                this._appendOverrideRow(settings, { overrides, wsh, wshos, oi, adwexprow, list_widget, list_objects });
            }
        }
    }

    _appendOverrideRow(settings, ctx) {
        const { overrides, wsh, wshos, oi, adwexprow, list_widget, list_objects } = ctx;
        const o = wshos[oi];
        let query = _("ANY");
        const row = new Adw.ActionRow();

        if (o.query) query = JSON.stringify(o.query);
        row.set_title(query);
        adwexprow.add_row(row);

        const threshold_widget = Gtk.SpinButton.new_with_range(0, 1, 0.01);
        threshold_widget.set_numeric(true);
        threshold_widget.set_digits(2);
        threshold_widget.set_climb_rate(0.1);
        threshold_widget.set_valign(Gtk.Align.CENTER);
        row.add_suffix(threshold_widget);
        if (o.query !== undefined) threshold_widget.set_sensitive(false);
        if (o.threshold !== undefined) threshold_widget.set_value(o.threshold);
        const threshold_signal = threshold_widget.connect("value-changed", (spin) => {
            let threshold = spin.get_value();
            this._rebuildOverrides = false;
            if (threshold <= 0.01) threshold = undefined;
            wshos[oi].threshold = threshold;
            settings.set_string(Common.SETTINGS_KEY_OVERRIDES, JSON.stringify(overrides));
        });

        const action_widget = new Gtk.ComboBoxText();
        action_widget.append_text(_("IGNORE"));
        action_widget.append_text(_("RESTORE"));
        action_widget.append_text(_("DEFAULT"));
        action_widget.set_valign(Gtk.Align.CENTER);
        row.add_suffix(action_widget);
        if (o.action === undefined) action_widget.set_active(2);
        else action_widget.set_active(o.action);
        const action_signal = action_widget.connect("changed", (combo) => {
            let action = combo.get_active();
            this._rebuildOverrides = false;
            if (action === 2) action = undefined;
            wshos[oi].action = action;
            settings.set_string(Common.SETTINGS_KEY_OVERRIDES, JSON.stringify(overrides));
        });

        const delete_widget = new Gtk.Button({
            valign: Gtk.Align.CENTER,
            css_classes: ["destructive-action"],
        });
        delete_widget.set_tooltip_text(_("Delete"));
        delete_widget.set_icon_name("user-trash-symbolic");
        row.add_suffix(delete_widget);
        const delete_signal = delete_widget.connect("clicked", () => {
            wshos.splice(oi, 1);
            if (wshos.length < 1) delete overrides[wsh];
            settings.set_string(Common.SETTINGS_KEY_OVERRIDES, JSON.stringify(overrides));
        });

        list_widget.add(row);

        list_objects.push({
            threshold: [threshold_signal, threshold_widget],
            action: [action_signal, action_widget],
            delete: [delete_signal, delete_widget],
        });
    }

    _cleanupNonOccupiedWindows(settings) {
        Common.cleanupNonOccupiedWindows(settings);
    }

    _loadSavedWindowsSetting(settings, list_widget, list_objects, list_rows) {
        const saved_windows = JSON.parse(settings.get_string(Common.SETTINGS_KEY_SAVED_WINDOWS));
        this._clearListWidget(list_widget, list_objects, list_rows);
        for (const wsh of Object.keys(saved_windows)) {
            let sws = saved_windows[wsh];
            for (const [swi, sw] of sws.entries()) {
                const row = new Adw.ActionRow();
                list_rows.push(row);
                row.set_title(wsh + " - " + sw.title);
                row.set_tooltip_text(wsh + " - " + sw.title);
                if (!sw.occupied) row.set_subtitle(_("Not occupied"));
                const delete_widget = new Gtk.Button({
                    valign: Gtk.Align.CENTER,
                    css_classes: ["destructive-action"],
                });
                delete_widget.set_tooltip_text(_("Delete"));
                delete_widget.set_icon_name("user-trash-symbolic");
                row.add_suffix(delete_widget);
                const delete_signal = delete_widget.connect("clicked", () => {
                    sws.splice(swi, 1);
                    if (sws.length < 1) delete saved_windows[wsh];
                    settings.set_string(Common.SETTINGS_KEY_SAVED_WINDOWS, JSON.stringify(saved_windows));
                });

                const override_widget = new Gtk.Button({
                    valign: Gtk.Align.CENTER,
                });
                override_widget.set_tooltip_text(_("OVERRIDE"));
                override_widget.set_icon_name("application-add-symbolic");
                row.add_suffix(override_widget);
                const override_signal = override_widget.connect(
                    "clicked",
                    this._override.bind(this, settings, wsh, sw.title)
                );

                const override_any_widget = new Gtk.Button({
                    label: _("ANY"),
                    valign: Gtk.Align.CENTER,
                    css_classes: ["suggested-action"],
                });
                override_any_widget.set_tooltip_text(_("OVERRIDE (ANY)"));
                override_any_widget.set_icon_name("application-add-symbolic");
                row.add_suffix(override_any_widget);
                const override_any_signal = override_any_widget.connect(
                    "clicked",
                    this._override_any.bind(this, settings, wsh)
                );

                list_widget.add(row);

                list_objects.push({
                    delete: [delete_signal, delete_widget],
                    ignore: [override_signal, override_widget],
                    ignore_any: [override_any_signal, override_any_widget],
                });
            }
        }
    }

    _resetSettings(settings, strKey) {
        if (strKey === "all") {
            // List all keys you want to reset
            const keys = [
                Common.SETTINGS_KEY_DEBUG_LOGGING,
                Common.SETTINGS_KEY_QUICKSETTINGS,
                Common.SETTINGS_KEY_NOTIFICATIONS,
                Common.SETTINGS_KEY_SYNC_MODE,
                Common.SETTINGS_KEY_MATCH_THRESHOLD,
                Common.SETTINGS_KEY_SYNC_FREQUENCY,
                Common.SETTINGS_KEY_SAVE_FREQUENCY,
                Common.SETTINGS_KEY_STARTUP_DELAY,
                Common.SETTINGS_KEY_FREEZE_SAVES,
                Common.SETTINGS_KEY_ACTIVATE_WORKSPACE,
                Common.SETTINGS_KEY_IGNORE_POSITION,
                Common.SETTINGS_KEY_IGNORE_WORKSPACE,
                Common.SETTINGS_KEY_IGNORE_MONITOR,
            ];
            for (const key of keys) {
                if (settings.is_writable(key)) {
                    settings.reset(key);
                }
            }
        } else if (settings.is_writable(strKey)) {
            settings.reset(strKey);
        }
    }

    _findWidgetByType(parent, type) {
        for (const child of parent) {
            if (child instanceof type) return child;

            const match = this._findWidgetByType(child, type);
            if (match) return match;
        }
        return null;
    }

    _addResetButton(window, settings) {
        const button = new Gtk.Button({
            label: _("Reset Settings"),
            icon_name: "edit-clear",
            css_classes: ["destructive-action"],
            vexpand: true,
            valign: Gtk.Align.END,
        });
        button.set_tooltip_text(_("Reset all settings to default values"));
        button.connect("clicked", () => {
            this._resetSettings(settings, "all");
        });

        const header = this._findWidgetByType(window.get_content(), Adw.HeaderBar);
        if (header) {
            header.pack_start(button);
        }
    }
}
