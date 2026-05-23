# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

SmartAutoMoveNG is a GNOME Shell extension that records application window
position, size, monitor, workspace, and state, then restores matching windows on
later launches. It supports Wayland and targets recent GNOME Shell versions.

The extension UUID is `SmartAutoMoveNG@lauinger-clan.de`; extension source lives
inside the directory with that exact name.

## Repository Layout

- `SmartAutoMoveNG@lauinger-clan.de/extension.js`: GNOME Shell runtime code,
  Quick Settings integration, settings watchers, window sync, save, and restore
  behavior.
- `SmartAutoMoveNG@lauinger-clan.de/prefs.js`: preferences UI logic using
  libadwaita/Gtk/Gio.
- `SmartAutoMoveNG@lauinger-clan.de/lib/common.js`: shared constants plus pure
  helpers for window scoring, saved-window matching, override matching, and
  cleanup.
- `SmartAutoMoveNG@lauinger-clan.de/ui/prefs-adw.ui`: Gtk Builder UI for the
  preferences window.
- `SmartAutoMoveNG@lauinger-clan.de/schemas/org.gnome.shell.extensions.SmartAutoMoveNG.gschema.xml`:
  GSettings schema. Keep keys in sync with `lib/common.js`, `extension.js`, and
  `prefs.js`.
- `SmartAutoMoveNG@lauinger-clan.de/metadata.json`: extension metadata,
  supported shell versions, release version, gettext domain, and schema id.
- `SmartAutoMoveNG@lauinger-clan.de/test/common.test.js`: lightweight assertion
  coverage for the pure helpers in `lib/common.js`.
- `po/`: gettext template and translations.
- `examples/`: example dconf configurations.
- `docs/`: screenshots used by the README.
- `.github/workflows/`: CI, release, and stale issue automation.
- `smartautomoveng.sh`: helper script for packaging, installing, uploading, and
  updating translations.

## Useful Commands

- `npm install`: install local JavaScript tooling.
- `npm run lint`: run ESLint across the repository.
- `./smartautomoveng.sh zip`: build
  `SmartAutoMoveNG@lauinger-clan.de.shell-extension.zip`.
- `./smartautomoveng.sh install`: build if needed, install, and enable the
  extension locally.
- `./smartautomoveng.sh translate`: update `po/SmartAutoMoveNG.pot` and merge
  existing `.po` files after user-visible string changes.

Notes:

- `npm test` is currently a placeholder that exits with failure. Do not present
  it as a passing validation command unless it has been fixed.
- Packaging requires GNOME tooling such as `gnome-extensions`; translation
  updates require gettext tools such as `xgettext`, `msgmerge`, and `msgattrib`.
- The GitHub release workflow builds with `dbus-run-session -- ./smartautomoveng.sh zip`.

## Coding Conventions

- Use modern GJS ES modules and imports consistent with the existing files.
- Prefer constants from `lib/common.js` for settings keys and sync-mode values.
- Keep settings schema keys, UI widget bindings, and common constants aligned.
- Preserve the JSON-on-string GSettings format for `saved-windows` and
  `overrides`.
- Use `Object.hasOwn(...)` as the existing code does when checking JSON object
  maps.
- Add gettext wrapping for user-visible strings in extension and preferences UI.
- Keep changes scoped. Avoid unrelated cleanup in runtime code because GNOME
  Shell extension regressions can be hard to diagnose.
- This project uses 4-space indentation in JavaScript, JSON, YAML, and XML.

## Runtime Behavior To Handle Carefully

- `extension.js` schedules recurring GLib timeouts for window sync and settings
  saves. When adding new timers or signal connections, disconnect/remove them in
  `disable()`.
- Window identity is heuristic. Matching uses window section hash
  (`get_wm_class()`), title similarity, occupied state, and override thresholds.
- Saved windows and overrides are persisted as JSON strings in GSettings; invalid
  JSON will break preferences and runtime loading.
- Workspace handling includes an override of
  `Main.wm._workspaceTracker._checkWorkspaces` to keep dynamic workspaces alive
  while moving windows. Treat this area as GNOME-version-sensitive.
- Quick Settings toggle behavior is configurable via the
  `quicksettings-usage` enum. If that enum changes, update schema, common
  constants/usages, preferences bindings, and toggle binding logic together.
- Preferences list rows connect Gtk signals dynamically. When adding rows, make
  sure `_clearListWidget()` can disconnect any new signal handles.

## Validation Checklist

Before finishing changes, run the validations that match the edit:

- JavaScript changes: `npm run lint`.
- Shared matching logic: run or extend
  `SmartAutoMoveNG@lauinger-clan.de/test/common.test.js` with the available GJS
  setup, or explain if local GJS execution is not available.
- Schema, metadata, packaging, icon, UI, or translation changes:
  `./smartautomoveng.sh zip`.
- User-visible strings: `./smartautomoveng.sh translate`.

If a required GNOME or gettext command is unavailable in the environment, state
that clearly in the final response.

## Release Notes For Agents

- Version metadata is in `metadata.json` (`version` and `version-name`).
- Tags matching `v*` trigger the release workflow.
- The release artifact name is
  `SmartAutoMoveNG@lauinger-clan.de.shell-extension.zip`.
- Do not commit generated extension zip files unless the maintainer explicitly
  requests it.
