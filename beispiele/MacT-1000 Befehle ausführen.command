#!/bin/bash
# Doppelklick im Finder führt dieses Skript aus.
# MacT-1000 aus Automator aufrufen – Befehle nach Bedarf anpassen.
MACT="/Applications/MacT-1000.app/Contents/Resources/bin/mact1000"
[ -x "$MACT" ] || MACT="$(command -v mact1000)"
"$MACT" --local --run "uptime" --run "df -h /"
# weitere Beispiele:
# "$MACT" --ssh admin@10.0.0.1 --run "show version" --split right
# "$MACT" --session "Rechenzentrum/core-sw01" --macro "Backup" --var ziel=10.0.0.5
# "$MACT" --folder "Rechenzentrum" --multi
# Ausgabe in eine Datei schreiben und das Pane danach schließen (3 s nach der letzten Ausgabe):
# "$MACT" --ssh admin@10.0.0.1 --run "show running-config" --log ~/Logs/core-sw01.log --close 3
# Befehle ausführen und MacT-1000 danach ganz beenden:
# "$MACT" --local --run "brew update" --quit
