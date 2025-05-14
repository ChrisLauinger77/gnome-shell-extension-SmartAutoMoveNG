#!/bin/bash

reffile=SmartAutoMove.pot

xgettext --from-code=UTF-8 --output=po/"$reffile" SmartAutoMove\@lauinger-clan.de/*.js SmartAutoMove\@lauinger-clan.de/schemas/*.xml SmartAutoMove\@lauinger-clan.de/ui/*.ui

cd po

for pofile in *.po
	do
		echo "Updating: $pofile"
		msgmerge -U "$pofile" "$reffile"
	done

rm *.po~
echo "Done."

