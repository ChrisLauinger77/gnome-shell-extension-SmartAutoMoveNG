#!/bin/bash
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
script_path="$script_dir/$(basename -- "${BASH_SOURCE[0]}")"
cd "$script_dir" || exit 1

extension="SmartAutoMoveNG@lauinger-clan.de"
extensionfile="$extension.shell-extension.zip"
metadata_file="$extension/metadata.json"

source "$script_dir/.githooks/version-utils.sh"
source "$script_dir/.githooks/version-actions.sh"

echo "Running $0 for $extension with arguments: $@"

case "${1:-}" in
  cleanup)
    if [[ -f "$extensionfile" ]]; then
      rm -- "$extensionfile"
      echo "Removed generated archive: $extensionfile"
    else
      echo "No generated archive to remove: $extensionfile"
    fi
    ;;
  check-version)
    check_version
    ;;
  update-version)
    update_version
    ;;
  setup-hooks)
    if git config --local core.hooksPath .githooks; then
      echo "Git hooks enabled using .githooks"
    else
      exit $?
    fi
    ;;
  zip|pack)
    "$script_path" cleanup
    cd "$extension"
    gnome-extensions pack --podir=../po/ --out-dir=../ --extra-source=./lib --extra-source=./ui/ --extra-source=./icons/ --extra-source=../LICENSE --force
    cd ..
    echo "Extension zip created ..."
    ;;
  install)
    if [[ ! -f "$extensionfile" ]]; then
      "$script_path" zip
    fi
    gnome-extensions install "$extensionfile" --force
    gnome-extensions enable "$extension"
    echo "Extension zip installed ..."
    ;;
  upload)
    if [[ ! -f "$extensionfile" ]]; then
      "$script_path" zip
    fi
    gnome-extensions upload --accept-tos --user ChrisLauinger77 --password-file /var/data/dev/ego_password "$extensionfile"
    ;;
  translate)
    reffile=SmartAutoMoveNG.pot
    xgettext --from-code=UTF-8 --output=po/"$reffile" "$extension"/*.js "$extension"/schemas/*.xml "$extension"/ui/*.ui
    cd po
    for pofile in *.po
      do
        echo "Updating: $pofile"
        msgmerge --backup=off -N -U "$pofile" "$reffile"
        msgattrib --no-obsolete -o "$pofile" "$pofile"
      done
    echo "Done."
    ;;
  *)
    echo "Usage: $0 {zip|pack|install|translate|upload|cleanup|check-version|update-version|setup-hooks}"
    exit 1
    ;;
esac
