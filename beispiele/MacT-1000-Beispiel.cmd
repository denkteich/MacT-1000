@echo off
rem MacT-1000 aus einer Batch-Datei aufrufen. Pfad zur EXE anpassen.
rem Installierte Version:
set MACT="%LOCALAPPDATA%\Programs\MacT-1000\MacT-1000.exe"
rem Portable Version (liegt eine Ebene ueber diesem Ordner):
if not exist %MACT% set MACT="%~dp0..\MacT-1000-1.6.0-portable.exe"
start "" %MACT% --local --run "ipconfig /all"
rem Weitere Beispiele:
rem start "" %MACT% --ssh admin@10.0.0.1 --run "show version" --split right
rem start "" %MACT% --serial COM3:115200
rem start "" %MACT% --folder Rechenzentrum --multi
rem Befehl ausfuehren, Ausgabe protokollieren, danach schliessen:
rem start "" %MACT% --ssh admin@10.0.0.1 --run "show running-config" --log "%USERPROFILE%\Logs\core-sw01.log" --close 3
rem Ausfuehren und MacT-1000 danach beenden:
rem start "" %MACT% --local --run "ipconfig /all" --quit
rem Feste Plaetze: erster Aufruf oben, naechster unten im selben geteilten Tab:
rem start "" %MACT% --ssh admin@10.0.0.1 --layout core --slot oben
rem start "" %MACT% --ssh admin@10.0.0.2 --layout core --slot unten
