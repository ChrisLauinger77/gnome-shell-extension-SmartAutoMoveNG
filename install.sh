#!/bin/bash

# glib-compile-schemas HeadsetControl\@lauinger-clan.de/schemas/

cd SmartAutoMoveNG\@lauinger-clan.de
gnome-extensions pack --podir=../po/ --out-dir=../ --extra-source=./lib --extra-source=./ui/ --extra-source=./icons/ --extra-source=../LICENSE
cd ..

if [ "$1" = "zip" ] || [ "$1" = "pack" ]; then
   echo "Extension zip created ..."
else
    gnome-extensions install SmartAutoMoveNG\@lauinger-clan.de.shell-extension.zip --force
    gnome-extensions enable SmartAutoMoveNG\@lauinger-clan.shell-extension.de

