#!/bin/bash

# glib-compile-schemas HeadsetControl\@lauinger-clan.de/schemas/

cd SmartAutoMoveNG\@lauinger-clan.de
gnome-extensions pack --podir=../po/ --out-dir=../ --extra-source=./lib --extra-source=./ui/ --extra-source=./icons/ --extra-source=../LICENSE --force
cd ..

case "$1" in
  zip|pack)
    echo "Extension zip created ..."
    ;;
  install)
    gnome-extensions install SmartAutoMoveNG\@lauinger-clan.de.shell-extension.zip --force
    gnome-extensions enable SmartAutoMoveNG\@lauinger-clan.shell-extension.de
    ;;
  upload)
    gnome-extensions upload SmartAutoMoveNG\@lauinger-clan.de.shell-extension.zip
    ;;
  *)
    echo "Usage: $0 {zip|pack|install|upload}"
    exit 1
    ;;
esac