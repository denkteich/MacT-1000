Examples for external calls (MacT-1000 1.6.0 or later, macOS and Windows)
Deutsch: siehe LIESMICH.txt

macOS
-----
MacT-1000 Befehle ausführen.workflow   Automator workflow with the action "Run Shell Script".
                                       Double-click opens it in Automator; adjust the commands, Run.
MacT-1000 Befehle ausführen.command    The same as a script for Finder (double-click).
MacT-1000 aufrufen.applescript         For Script Editor or Shortcuts ("Run AppleScript").

Windows
-------
MacT-1000-Beispiel.cmd                 Batch file (double-click); adjust the path to the EXE if needed.
MacT-1000-Beispiel.ps1                 PowerShell script; adjust the path to the EXE if needed.
                                       For shortcuts: Desktop -> New -> Shortcut, command as target.
                                       For scheduled jobs: Task Scheduler with the same command.

(The comments inside the templates are in German.)

The first time, MacT-1000 asks before commands run. With "Run exactly this call without asking in
future" the same call runs directly afterwards. All options: window "External calls"
(macOS: MacT-1000 menu, Windows: Help menu) or README.en.md, section "External calls".

Close afterwards: --close [SEC] closes the pane as soon as no output has arrived for SEC seconds after
the last command; --quit then quits MacT-1000 completely (if nothing else is running);
--log FILE appends the output to a file.

Fixed slots in a split window: --layout NAME --slot top|bottom|left|right|next opens a target in a
fixed slot of a split tab, e.g. first call --slot top, next call --slot bottom.
--grid 2h|2v|4 selects the grid, --busy ask|replace|new|cancel the behavior if the slot is already
occupied. The German values used in the templates (oben, unten, neu …) work as well.

Former wint1000:// links of the Windows edition (called WinT-1000 up to 1.5.23) keep working.

CSV template for the session import (from 1.7.0)
sessions-import-en.csv (German: sessions-import.csv) shows the layout for
File → Import sessions from CSV…: columns Folder;Name;Type;Host;Port;User;Password;…
Subfolders are separated with / in the Folder field (e.g. Datacenter/Core/Switches).
A row with type "Folder" and a default password sets the folder's default password.
The file can be opened and edited directly in Excel.
