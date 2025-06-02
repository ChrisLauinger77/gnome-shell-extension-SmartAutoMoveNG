#!/bin/bash

reffile=SmartAutoMoveNG.pot

xgettext --from-code=UTF-8 --output=po/"$reffile" SmartAutoMoveNG\@lauinger-clan.de/*.js SmartAutoMoveNG\@lauinger-clan.de/schemas/*.xml SmartAutoMoveNG\@lauinger-clan.de/ui/*.ui

cd po

for pofile in *.po
	do
		echo "Updating: $pofile"
		msgmerge -U "$pofile" "$reffile"
	done

rm *.po~
echo "Done."

