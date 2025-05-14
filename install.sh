#!/bin/bash

# glib-compile-schemas HeadsetControl\@lauinger-clan.de/schemas/

cd SmartAutoMove\@lauinger-clan.de
gnome-extensions pack --podir=../po/ --out-dir=../ --extra-source=lib/common.js --extra-source=ui/prefs-adw.ui --extra-source=../LICENSE
cd ..
mv SmartAutoMove@lauinger-clan.de.shell-extension.zip SmartAutoMove@lauinger-clan.de.zip

if [ "$1" = "zip" ]; then
   echo "Extension zip created ..."
else
    gnome-extensions install SmartAutoMove\@lauinger-clan.de.zip --force
    gnome-extensions enable SmartAutoMove\@lauinger-clan.de
fi

