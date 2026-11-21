# MacT-1000

> The name is a nod to the T-1000 from "Terminator 2" – the liquid-metal Terminator that can split apart and flow back together. Just like the windows of MacT-1000.

Version 1.8.1 · Copyright © 2026 Harald Thomas · MIT License · [Deutsche Version](README.md)

Terminal client for **macOS and Windows** – local shell, SSH (with SCP file transfer), Telnet, serial console and RDP in one window, with freely splittable panes, Multi-Input and Multi-Paste. Plus built-in TFTP, FTP, HTTP and SFTP/SCP servers for firmware updates and configuration backups. User interface in English or German.

Project and updates: [github.com/denkteich/MacT-1000](https://github.com/denkteich/MacT-1000)

> **One project from 1.6.0 on:** Up to 1.5.23 the Windows edition was called **WinT-1000**; it is now also named MacT-1000 – same source code, same features, same version numbers. How data is taken over is described under "Moving from WinT-1000".

## Language

The user interface is available in **English** and **German** – menus, dialogs, notices, tooltips and messages in the terminal.

- **Default "Automatic (system)":** MacT-1000 uses the language of the operating system (macOS: System Settings → General → Language & Region; Windows: Settings → Time & language). German if the system language is German, English otherwise.
- **Switching:** Settings (⚙) → at the very top **"Language / Sprache"** → Automatic (system), Deutsch or English. The change applies immediately without a restart – including the menu.
- The setting applies to this computer only and is not shared through the network configuration.
- Names you assign yourself (sessions, folders, macros, layouts) are not translated. Values for external calls work in both languages (`--slot top` = `--slot oben`, `--busy new` = `--busy neu`).
- Dates and numbers follow the selected language.

## Installation on macOS

1. Unzip the matching ZIP file:
   - `MacT-1000-1.8.1-arm64-mac.zip` – Apple Silicon (M1/M2/M3/M4)
   - `MacT-1000-1.8.1-x64-mac.zip` – Intel Macs
2. Drag `MacT-1000.app` to `/Applications`.
3. The app is ad-hoc signed but not notarized by Apple. Before the first start, run once in Terminal:
   ```bash
   find /Applications/MacT-1000.app -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
   ```
   Alternatively: System Settings → Privacy & Security → "Open Anyway".
   If macOS reports the app as "damaged": `codesign --force --deep --sign - /Applications/MacT-1000.app`
4. For USB serial adapters (FTDI, Prolific, CH340, Silicon Labs) install the manufacturer's driver if needed – many work on macOS without a driver.

Data is stored in `~/Library/Application Support/MacT-1000/`.

## Installation on Windows

Windows 10/11 (64-bit). Two variants:

| | Installable (setup) | Portable |
|---|---|---|
| File | `MacT-1000-1.8.1-setup.exe` | `MacT-1000-1.8.1-portable.exe` |
| Installation | Wizard (English/German); default folder `%LOCALAPPDATA%\Programs\MacT-1000`, folder selectable; Start menu and desktop shortcut | none – copy the EXE anywhere (e.g. `C:\Tools`, USB stick) and start it |
| Administrator rights | not required (installs for the current user only) | not required |
| `mact1000://` links | registered during installation (former `wint1000://` links as well) | in the "External calls" window → "Set up links for this EXE" |
| Updates | automatic: downloads the installer, verifies SHA-256, installs silently after confirmation and restarts | notice only; "Download" opens the release page, the EXE does not replace itself |
| Uninstall | Settings → Apps → MacT-1000 | delete the EXE |

Neither variant is code-signed. On the first start Windows SmartScreen may show "Windows protected your PC" → "More info" → "Run anyway".

Settings, sessions and macros are stored in `%APPDATA%\MacT-1000` for both variants – they are kept across updates and when switching between setup and portable EXE. The portable EXE unpacks itself into a temporary folder on start, so the first start takes a few seconds.

### Using MacT-1000 on Windows

Features and user interface are the same as on macOS. Differences:

| Area | macOS | Windows |
|---|---|---|
| Local shell | Login shell (`$SHELL`, e.g. zsh) | PowerShell 7 (`pwsh`), otherwise Windows PowerShell, otherwise `cmd.exe`; custom shell in Settings |
| SSH | System `ssh` | built-in OpenSSH client (`C:\Windows\System32\OpenSSH\ssh.exe`); if missing: Settings → System → Optional features → "OpenSSH Client" |
| File browser | via SCP over the terminal's connection | via SCP (own connection, asks for password/passphrase itself; from 1.7.0, previously SFTP) |
| RDP | "Windows App" or FreeRDP | Remote Desktop Connection (`mstsc.exe`) |
| Serial | `/dev/cu.*` | COM ports, e.g. `COM3 115200` in Quick Connect |
| Passwords | encrypted, key in the macOS Keychain | encrypted with the Windows user account (DPAPI) |
| Menu | MacT-1000, File, Edit, Macros, View, Window | File, Edit, Macros, View, Help (Settings under File, About/Updates under Help) |
| Keyboard shortcuts | ⌘ combinations | Ctrl+Shift or Alt+Shift, so that Ctrl+letter stays free for the shell – see "Keyboard shortcuts" |
| File manager | Finder | Explorer |

## Features

| Area | Details |
|---|---|
| Local shell | Login shell, start directory, start command; duplicating (⌘D / Ctrl+Shift+E) keeps the current directory |
| SSH keys & Keychain (macOS) | Per-session option (default: on): the passphrase is stored in the macOS Keychain on the first connection (`UseKeychain`/`AddKeysToAgent`) and used automatically afterwards. Also: File → "Store SSH key in Keychain…" and `ssh-add --apple-load-keychain` at startup |
| SSH | Uses the system `ssh` → `~/.ssh/config`, keys, ssh-agent, jump hosts (-J), port forwarding (L/R/D), agent/X11 forwarding, keepalive, option for legacy algorithms (older switches); a stored password is entered automatically at the login prompt (see "Passwords") |
| File transfer (SCP) | Sidebar tab "Files (SCP)" follows the active SSH pane: browse directories, upload/download files and folders with progress, drag & drop from Finder/Explorer, create folders, rename, delete, "Change to this directory in the terminal (cd)" |
| Servers (TFTP, FTP, HTTP, SFTP/SCP) | Sidebar tab "Servers": four file servers, each configurable and startable on its own – directory, port, network address, user/password, permissions (read, upload, overwrite, delete). Shared transfer list with progress, e.g. for firmware updates and configuration backups of switches/routers |
| External calls | Start from Automator, Shortcuts, AppleScript, Terminal, batch files or PowerShell (`mact1000 --local --run "uptime"`) and via `mact1000://` links – local shell, SSH, Telnet, serial, RDP, saved sessions and folders, with commands and macros, output to a file and automatic closing afterwards (`--log`, `--close`, `--quit`) as well as fixed slots in a split tab (`--layout core --slot top`, then `--slot bottom`); commands only after confirmation |
| Updates | Checks the latest GitHub release at startup and every 6 hours and asks first: install now, remind later or skip this version; then downloads (SHA-256 verified), installs after confirmation and restarts |
| Telnet | Own implementation with option negotiation (ECHO, SGA, TTYPE, NAWS = window size), auto-login, CR/LF mode, raw TCP for console servers, Break/Interrupt. If a password is stored, auto-login is enabled automatically |
| Serial | All `/dev/cu.*` ports (Windows: COM ports), baud rate 300–921600, data bits, parity, stop bits, RTS/CTS or XON/XOFF, break signal (e.g. Cisco ROMMON), toggle DTR/RTS, local echo |
| RDP | macOS: starts "Windows App" (Microsoft, App Store) with a generated .rdp file, or FreeRDP (`brew install freerdp`, password prompt in the pane). Windows: `mstsc.exe`. Resolution, multi-monitor, clipboard, drives, RD Gateway, admin session |
| Split panes | Every pane can be split vertically (side by side) and horizontally (one above the other) as often as you like; drag the divider with the mouse (double-click = 50/50), maximize a pane, distribute evenly, move a pane to a new tab. Rearrange tabs and panes by drag & drop (see below) |
| Multi-Input | Keystrokes go to all selected panes at the same time – across tabs. Include/exclude per pane via the ⇶ symbol. Selected panes have an orange border |
| Macros | Sequences "wait for output → send input", created manually or recorded, variables asked for at start, loops over numbers (1,2,3 7-10) or texts, autostart after connecting, execution on several panes; auto-responses to specific output (see below) |
| Multi-Paste | Send text/commands to selected panes: as a block (bracketed paste) or line by line with a delay, placeholders `{{name}}`, `{{host}}`, `{{user}}`, `{{n}}`, history of the last 20 entries |
| Sharing panes | Share a pane with other computers running MacT-1000 (pane menu → "Share session…"): encrypted via SSH, password, read only or write after approval, expiry, viewer list with disconnect; viewers connect via Quick Connect `share host` (see below) |
| Session management | Sidebar with folders and subfolders of any depth (right-click → "New folder…" / "New subfolder…", move sessions and folders by drag & drop), colors, filter; passwords stored encrypted; export/import of the entire configuration; optional shared configuration on a network drive for all computers (see below) |
| Convenience | Quick Connect (`user@host`, `telnet host 2001`, `/dev/cu.usbserial 115200` or `COM3 115200`, `rdp admin@host`), drag & drop of sessions onto panes (edge = open split), folder "Open all as tiles", search in the buffer, save buffer as log, copy/paste with right-click, 4 color schemes, layout restore, English and German user interface |

## Exporting / importing the configuration

Menu **File → Export entire configuration…** (⇧⌘E on the Mac) or in Settings (⚙). The JSON file contains:

- the complete address book: all sessions with folders, colors and all connection options (SSH, Telnet, serial, RDP, command)
- all settings (font, color scheme, behavior …) including macros and auto-responses
- tab/split layout, collapsed folders and Multi-Paste history
- optionally the stored passwords – encrypted only (AES-256-GCM, key derived via scrypt from an export password)

**File → Import configuration…** shows the contents of the file and offers "Merge" (identical sessions are updated, new ones added, local passwords are kept) or "Replace". Settings and layout can be deselected individually; an imported layout opens at the next start. Older session exports (plain JSON list) and exports from WinT-1000 are recognized as well. SSH key passphrases from the macOS Keychain are not exported.

"Export Address Book Only (without Passwords)…" creates a simple session list.

If passwords are exported, the default passwords of folders are included as well (from 1.7.0, also encrypted).

## Importing sessions from CSV (from 1.7.0)

Menu **File → Import sessions from CSV…**, in the settings (⚙) or right-click a folder → **"Import sessions from CSV into this folder…"**. This takes over bookmarks from Excel, an inventory list or another program – including folders and subfolders.

- **Columns:** detected from the header row (English or German, case-insensitive): `Folder`, `Name`, `Type`/`Protocol`, `Host`/`Hostname`, `Port`, `User`, `Password`, `Key file`, `Jump host`, `Device` (serial, e.g. `COM3` or `/dev/cu.usbserial`), `Baud rate`, `Domain` (RDP), `Color`, `Default password`. German headers such as `Ordner`, `Benutzer`, `Passwort` work too. Each column can be assigned or ignored manually in the dialog; without a header row the order Name, Type, Host, Port, User, Folder, Password applies.
- **Subfolders:** separate them with `/` in the `Folder` field – `\` or `>` are recognized too: `Datacenter/Core/Switches` creates three nested folders. Missing folders are created automatically. With **Target folder** the whole import goes below an existing folder.
- **Type:** `SSH`, `Telnet`, `RDP`, `Serial` (also `COM`, `Console`), `Local`. Empty fields get the selected default type. The port is optional (22/23/3389); `user@host:port` in the host field is split up.
- **Folder rows:** a row with type `Folder` creates a (possibly empty) folder; a password or `Default password` there becomes the default password of this folder (see "Passwords").
- **Delimiter and encoding:** semicolon, comma, tab or `|` are detected automatically, quotes as in Excel. UTF-8 (with/without BOM), UTF-16 and Windows-1252 (Excel export with umlauts) are read.
- **Preview:** shows before importing what will be created, updated or skipped and which rows have errors (e.g. missing host). Existing sessions (same folder, name, type, host, port, user) are skipped, updated or added anyway – your choice.
- Passwords from the CSV are stored encrypted. Best delete the CSV file afterwards.
- **Template:** "Save template…" in the dialog or `beispiele/sessions-import-en.csv` (German: `sessions-import.csv`):

```
Folder;Name;Type;Host;Port;User;Password;Key file;Baud rate;Default password
Datacenter;;Folder;;;;;;;SecretDC-Password
Datacenter/Core/Switches;core-sw01;SSH;10.0.0.1;22;admin;;;;
Datacenter/Core/Routers;edge-rt01;Telnet;10.0.1.1;23;admin;OwnPassword;;;
Lab/Consoles;Console COM3;Serial;COM3;;;;;9600;
```

## Shared configuration on a network drive

Menu **File → Network configuration (shared)…** or in Settings (⚙). Choose a folder on a mounted network drive (e.g. `/Volumes/Team/MacT-1000` or `\\server\share\MacT-1000`, SMB or NFS) – every computer using the same folder works with the same configuration, Macs and PCs alike.

- **Shared:** address book (all sessions with all options), session folders, macros and auto-responses. Optionally the general settings as well (font, color scheme, cursor, behavior).
- **Always local:** window size, sidebar, default shell, download folder, tab/split layout, Multi-Paste history, language.
- **Lock only while changing:** reading needs no lock. When a computer saves a change, it briefly creates `MacT-1000-config.lock` (atomic, with the computer name), reads the current file, merges, writes the new revision and releases the lock immediately. Another computer waits up to 10 s meanwhile. Orphaned locks (e.g. after a crash) are removed after 60 s.
- **Picked up automatically:** every computer checks the file every 2 seconds. If another computer changes something, address book, folders and macros are reloaded immediately; a notice shows which computer the change came from. Open connections are not affected, changed connection data applies from the next connection.
- **Simultaneous changes are not lost:** merging is done per session, per macro and per folder. If two computers change the same session, different fields are both kept; only for the same field does the most recently saved change win.
- **Network drive unreachable:** MacT-1000 continues with the last known state, changes are queued locally ("Network: pending" at the bottom of the sidebar) and synchronized automatically at the next contact.
- **Passwords:** by default stored passwords stay local on each computer (encrypted). With a **team passphrase** (enter the same on all computers) they are additionally stored AES-256-GCM-encrypted in the shared file. Computers without the passphrase do not see the passwords but do not overwrite them either.
- When enabling with an existing file: **Merge**, **Use file** or **Upload local configuration**. Before every change the previous version is saved with date and time in the subfolder `MacT-1000-Backups/`, e.g. `MacT-1000-config_2026-11-08_14-30-05_rev42.json`.
- **Keep backups:** adjustable in the network configuration dialog (default **15**, `0` = no backups, max. 500). Older backups are deleted automatically. The value applies to all computers. **Show in Finder** (Windows: Explorer) opens the backup folder.
- Restore: copy the desired backup back into the network folder as `MacT-1000-config.json` – all computers pick it up automatically.
- **Disconnect** takes the current shared state as the local configuration of this computer.
- A network folder created by WinT-1000 (`WinT-1000-config.json`) continues to be read and maintained.

## Configuration version

Every saved configuration contains the MacT-1000 version that wrote it – locally (`config-meta.json`), in the network file (`appVersion`) and in the export. In addition the **newest version** that ever edited the configuration is recorded, so the notice remains even if a computer with an older version saves afterwards.

- If the loaded configuration is **newer than the running MacT-1000 version**, a yellow notice with **Details** and **Hide** appears at the top (remembers the combination of configuration and program version). For the network configuration this is also checked when another computer saves with a newer version; the indicator at the bottom of the sidebar then reads "Network: newer version".
- **MacT-1000 → Configuration Version…** (Windows: Help menu; or Settings → "Check version and updates…") shows which version wrote the current configuration and compares the running version with the latest release on GitHub (see below).
- A notice also appears when importing an export file from a newer version and when connecting to a network folder whose file is newer.
- Configurations from versions up to 1.5.13 do not contain a local identifier yet and are shown as "unknown (before 1.5.14)".

## New versions (update notice and automatic update)

Shortly after starting and then every 6 hours MacT-1000 queries the latest release on GitHub ([github.com/denkteich/MacT-1000/releases](https://github.com/denkteich/MacT-1000/releases), "latest" – pre-releases and drafts do not count). Startup is not delayed; without internet nothing happens.

- If there is a **newer version** than the running one, a blue notice "New version available: MacT-1000 x.y.z" appears at the top with **Update now**, the link **Release page**, **What's new?** (release description), **Later** (until the next start) and **Skip** (do not report this version again; an even newer one is shown again).
- **Check for Updates…** checks immediately and shows the result in the "Version and configuration" window: latest release with link and date, comparison with the running version ("Up to date", "New version available" or "This version is newer than the latest release") and time of the check. If the check fails, the reason is shown; the last known state remains visible.
- If the loaded **configuration is newer** than the running version and there is a matching release, the yellow configuration notice also contains a download link.
- Query via the GitHub API; if its limit is reached (60 requests per hour and IP address), the version is determined via the redirect of the release page. Only a normal request with the identifier `MacT-1000/<version>` is sent, no further data.
- Turn off: Settings → "Check GitHub for a new MacT-1000 version at startup and every 6 hours" (applies to this computer only). "Check for Updates…" keeps working manually.

### Automatic update on macOS

1. When a newer version is found, MacT-1000 asks first (window "New version: MacT-1000 x.y.z" with the release description) – nothing is downloaded yet:
   - **Install now:** the update is downloaded (continue with step 2).
   - **Remind me later:** nothing is downloaded, the notice disappears. You are asked again at the next start of MacT-1000 or, if the program keeps running, after 24 hours.
   - **Skip this version:** this version is no longer reported; only an even newer version appears again. Via **Check for Updates…** it can still be installed at any time.

   MacT-1000 then downloads the matching package from the release in the background (`MacT-1000-<version>-arm64-mac.zip` for Apple Silicon or `…-x64-mac.zip` for Intel; under Rosetta the arm64 package is chosen as well). The notice shows the progress and **Cancel**.
2. Size and **SHA-256 checksum** (published by GitHub for every release asset) are verified, as well as the version number in the `Info.plist` of the unpacked app. If anything does not match, the update is discarded and the reason is shown (**Try again** / release page). Downloads come from github.com only.
3. If everything is fine, MacT-1000 asks "Install now and restart?" – with a note about active connections.
   - **Restart now:** MacT-1000 quits, a small helper script replaces `MacT-1000.app` (the old version is only deleted once the new one is in place; on error it is restored) and starts the new version. Afterwards "MacT-1000 was updated from a to b" appears.
   - **Later:** the update is installed at the next normal quit (without restart). Until then the green notice or the "Version and configuration" window shows **Restart and install**.
4. If the application folder does not belong to the logged-in user (e.g. a standard user without write access to `/Applications`), macOS asks for the **administrator password** during the replacement.

Notes:

- The automatic update only works if the app runs from a writable folder (preferably `/Applications`). If it is started directly from "Downloads", macOS moves it to a read-only quarantine location – a notice then asks you to move the app to "Applications" first. From a disk image or in development mode (`npm start`) there is only the notice with a link.
- The new package is ad-hoc signed only; the quarantine flag is removed during the replacement so that no Gatekeeper dialog appears.
- Releases must contain the packages under exactly these file names, otherwise only the notice with a link is shown.
- Turn off: Settings → "Ask about new versions … and install automatically" (then only the blue notice appears; the download starts only after clicking **Update now**, nothing is installed on quit).
- Working folder and log: `~/Library/Application Support/MacT-1000/updates/` (`install.log`). If the installation fails, MacT-1000 shows the last log lines at the next start.

### Updates on Windows

- **Installed version (setup):** as on macOS – confirmation, then `MacT-1000-<version>-setup.exe` is downloaded from the release, size and SHA-256 are verified, and after "Restart now" it is installed silently; MacT-1000 then restarts. With "Later" it is installed at the next quit. Log: `%APPDATA%\MacT-1000\updates\install.log`.
- **Portable EXE:** notice only; "Download" opens the release page, replace the `…-portable.exe` manually.
- Installations of the former WinT-1000 (up to 1.5.23) find the update to MacT-1000 through their previous release location, provided it is published there (see "Releases on GitHub").

## External calls (Automator, Terminal, Windows, links)

MacT-1000 can be started and controlled from Automator, Shortcuts, AppleScript, Terminal, batch files, PowerShell or Task Scheduler: open a connection, run commands, start a macro. If MacT-1000 is already running, a new tab opens in the existing window (there is only ever one instance). Overview with copyable examples: **MacT-1000 → External Calls (Automator, Terminal)…** (Windows: Help menu).

### Command-line tool `mact1000` (macOS)

Located in the app at `MacT-1000.app/Contents/Resources/bin/mact1000`. In the "External calls" window, **Install "mact1000" command…** creates a link at `/usr/local/bin/mact1000` (asks for the administrator password if needed); afterwards `mact1000 …` is enough in Terminal. Without installation `open -n -a MacT-1000 --args …` works too.

```
mact1000 --local --run "cd ~/Projects" --run "git status"
mact1000 --local --cwd ~/Downloads
mact1000 --ssh admin@10.0.0.1 --run "show version" --split right
mact1000 --telnet 10.0.0.2:23 --title "Console switch 2"
mact1000 --serial /dev/cu.usbserial-1410:115200
mact1000 --session "Data center/core-sw01" --macro "Backup" --var target=10.0.0.5
mact1000 --folder "Data center" --multi
mact1000 --ssh admin@10.0.0.1 --ssh admin@10.0.0.2 --tile --multi
mact1000 --ssh admin@10.0.0.1 --run "show running-config" --log ~/Logs/core-sw01.log --close 3
mact1000 --local --run "brew update" --quit
mact1000 --help
```

| Option | Meaning |
|---|---|
| `--local [COMMAND]` | Local shell (default shell from Settings); a command directly following it is the same as `--run` |
| `--shell PATH` | Local shell with a specific shell, e.g. `/bin/zsh` |
| `--ssh [user@]host[:port]`, `--telnet host[:port]`, `--rdp [user@]host[:port]`, `--serial /dev/…[:baud]` (Windows: `COM3[:baud]`) | New connection |
| `--connect "line"` | Like the Quick Connect field, e.g. `"ssh -J bastion admin@10.0.0.1"` |
| `--session "Folder/Name"` | Saved session (the name is enough if it is unique; the session's password, key and macro are used) |
| `--folder "Folder"` | All sessions of the folder (including subfolders) as tiles in one tab; with `--tabs` each in its own tab |
| `--run COMMAND` | Run a command (repeatable; before each command MacT-1000 waits for the prompt) |
| `--macro NAME`, `--var Name=Value` | Start a saved macro after the commands; missing inputs are asked for |
| `--cwd FOLDER` | Start directory of the local shell |
| `--title NAME` | Title of the pane |
| `--split right\|down\|tab\|here` | Open next to/below the active pane, new tab (default) or in the active pane if no connection is running there |
| `--layout NAME`, `--slot SLOT`, `--grid GRID`, `--busy WHAT` | Open in a fixed slot of a split tab, see "Fixed slots in a split window" |
| `--prompt REGEX` | Custom prompt pattern to wait for before each command (default: line ends with `$ # > % ]`) |
| `--close [SEC]` | Close the pane after the last command or macro: first wait for the prompt (at most 10 minutes), then close as soon as no output has arrived for SEC seconds (default 3, fractions like `0.5` allowed). If a command ends the connection itself (e.g. `exit`), the pane closes immediately. On errors (connection refused, login failed) it stays open with the message |
| `--log FILE` | Append the pane's output without color codes to FILE (full path or `~/…`; in Terminal also relative to the current folder). Folders are created; every run starts with a header line with date and target |
| `--tile` | All targets of this call as tiles in one tab |
| `--multi` | Turn on Multi-Input for the tab afterwards |
| `--quit` | Close all targets as with `--close` and then quit MacT-1000 – but only if no other sessions or servers are running |

Several targets in one call are possible; `--run`, `--macro`, `--var`, `--cwd`, `--title`, `--split`, `--layout`, `--slot`, `--grid`, `--busy`, `--prompt`, `--close` and `--log` each apply to the target before them. Passwords are deliberately not accepted as arguments – use saved sessions, keys or the Keychain instead.

### Fixed slots in a split window

So that several separate calls end up one after another in the same split window – e.g. the first at the top, the next at the bottom – the tab gets a name and every target a slot:

```
mact1000 --ssh admin@10.0.0.1 --layout core --slot top
mact1000 --ssh admin@10.0.0.2 --layout core --slot bottom
```

| Option | Meaning |
|---|---|
| `--layout NAME` | Name of the layout tab. If it does not exist yet, it is created and split accordingly; empty slots show "Waiting: bottom". Afterwards every call finds the tab by its name – no matter which tab or pane is currently active. Without this option the layout is called "Layout" |
| `--slot SLOT` | `top`, `bottom` (grid top/bottom), `left`, `right` (left/right), `top-left`, `top-right`, `bottom-left`, `bottom-right` (2×2), `1`–`4` (reading order) or `next` = next free slot. Short forms (`tl`, `tr` …) and the German names (`oben`, `unten`, `links`, `rechts` …) work as well. Default: `next` |
| `--grid GRID` | `2h` = top/bottom, `2v` = left/right, `4` = 2×2. Only needed with `next` or numbers – otherwise it follows from the slot. Applies only when creating; an existing layout tab keeps its grid |
| `--busy WHAT` | If a session is already running in the slot: `ask` (default), `replace` (end the previous session), `new` (split the slot additionally, the previous one keeps running), `cancel` (open nothing) |

Behavior in detail:

- A slot is free as long as it is waiting or its session has ended; ended sessions are replaced without asking.
- `next` fills waiting slots first, then ended ones, then closed ones; if all are occupied, the call opens a new tab.
- If a slot was closed (also by `--close`), the next call for this slot recreates it in the right place. If the whole tab is closed, the layout starts over with the next call.
- You can also open a connection yourself in a waiting slot – the slot is then occupied.
- `--multi` turns on Multi-Input for all areas of the layout tab.
- With "Restore tabs and split layout at startup" the layout name and slots are kept after a restart.
- The confirmation and the help show the slot, e.g. "Layout "core" · Slot bottom".

Without any extra parameters, use the setting **External calls without slot** (Settings): top/bottom, left/right or 2×2. All calls without `--split`, `--slot` or `--layout` then land one after another in the layout tab "Calls".

### Links `mact1000://`

The same options as a link – e.g. for Shortcuts ("Open URL"), AppleScript (`open location`), notes or an internal wiki:

```
mact1000://local?run=uptime&run=df%20-h
mact1000://ssh/admin@10.0.0.1?run=show%20version&split=right
mact1000://session/Data%20center/core-sw01?macro=Backup&var=target%3D10.0.0.5
mact1000://folder/Data%20center?multi=1
mact1000://ssh/admin@10.0.0.1?run=show%20version&close=3&log=~/Logs/sw.log
mact1000://ssh/admin@10.0.0.2?layout=core&slot=bottom
mact1000://help
```

Parameters as on the command line without `--` (`run`, `macro`, `var`, `cwd`, `title`, `split`, `layout`, `slot`, `grid`, `busy`, `prompt`, `close`, `log`, `tile`, `multi`, `tabs`, `quit`); spaces as `%20`. On macOS the scheme is registered once the app has been started; on Windows by the installer (portable: see "Installation on Windows"). Former `wint1000://` links keep working.

### In Automator

1. Open Automator → **Workflow** (or **Quick Action** for the Services menu or a keyboard shortcut) → action **Run Shell Script**.
2. Enter the command, e.g. `/Applications/MacT-1000.app/Contents/Resources/bin/mact1000 --local --run "uptime"` (or just `mact1000 …` if installed).
3. To close the window afterwards: append `--close` (the pane only) or `--quit` (quit MacT-1000 completely), and `--log ~/Logs/name.log` for the output.
4. Run. Ready-made template: `beispiele/MacT-1000 Befehle ausführen.workflow` (plus a `.command` file for Finder and an AppleScript).

### On Windows

All options work the same way. Instead of `mact1000` the EXE is called; the "External calls" window (Help menu) shows ready-made commands with the path of the running EXE. Examples for the installed version:

```bat
set M="%LOCALAPPDATA%\Programs\MacT-1000\MacT-1000.exe"
%M% --local --run "ipconfig"
%M% --ssh admin@10.0.0.1 --run "show version" --split right
%M% --serial COM3:115200
%M% --folder "Data center" --multi
%M% --ssh admin@10.0.0.1 --run "show running-config" --log "%USERPROFILE%\Logs\core-sw01.log" --close 3
%M% --ssh admin@10.0.0.2 --layout core --slot bottom
%M% --local --run "ipconfig /all" --quit
```

- `--log FILE`: a full path is required, e.g. `C:\Logs\sw.log`, `\\server\share\sw.log` or `~\Logs\sw.log` (`~` = user folder).
- `--close` and `--log` are not possible with RDP (separate program).
- Links: `mact1000://ssh/admin@10.0.0.1?run=show%20version&close=3`; former `wint1000://` links keep working.
- Templates in the `beispiele` folder: `MacT-1000-Beispiel.cmd` (batch) and `MacT-1000-Beispiel.ps1` (PowerShell). For shortcuts: right-click the desktop → New → Shortcut → one of the commands as target. For scheduled jobs use Task Scheduler with the same command.

### Security

- Calls that only open a connection or a shell run immediately.
- If a call contains **commands**, a **macro**, a **log file** (`--log`), a custom shell or additional ssh arguments (`--connect "ssh -o …"`), MacT-1000 shows exactly what will be executed beforehand and asks. So a link on a web page, for example, cannot execute anything unnoticed.
- **Run exactly this call without asking in future** remembers a fingerprint (SHA-256) of the complete call – if a command or target changes, you are asked again. Trusted calls are listed in the "External calls" window and can be removed there (stored on this computer only).
- Unknown sessions, macros, options or invalid targets: nothing is opened, an error message appears instead.
- Turn off: Settings → "Allow external calls …".

### Sharing directly (--share, from 1.8.1)

With `--share` the called pane is shared right after connecting (see [Sharing panes](#sharing-panes-from-180)) – e.g. from an Automator workflow or a script that then passes the connection data on to a colleague.

```
mact1000 --ssh admin@10.0.0.2 --share
mact1000 --session "Labor/Core-Switch" --share --share-mode ask --share-expires 60 --share-info ~/share.json
mact1000://ssh/admin@10.0.0.2?share=1&share-mode=ask
"C:\Program Files\MacT-1000\MacT-1000.exe" --ssh admin@10.0.0.2 --share --share-info %USERPROFILE%\share.json
```

| Option | Meaning |
|---|---|
| `--share` | Share the pane after connecting. Applies to the target before it (like `--run`); `--share no` turns it off again |
| `--share-mode MODE` | `ro` = read only (default), `ask` = write after confirmation, `rw` = read and write without asking |
| `--share-password PW` | Password of the share (4–128 characters). If omitted, a random one is generated and copied to the clipboard |
| `--share-name NAME` | Name the viewer sees. Default: title of the pane |
| `--share-expires MINUTES` | The share ends after this many minutes (at most 10080 = 7 days); `0` = until stopped (default) |
| `--share-info FILE` | Write the connection data as JSON to this file (full path, `~` allowed, folders are created, readable only by your own user) |

Every `--share-*` option turns on `--share` as well. Possible for local shell, SSH, Telnet, serial, command and saved sessions of these types – not for RDP and not for whole folders (`--folder`).

Content of the info file:

```json
{
  "name": "Core-Switch",
  "mode": "ask",
  "password": "k7Qm2xRpZa",
  "host": "macbook-harald",
  "addresses": ["192.168.1.20"],
  "port": 7022,
  "fingerprint": "SHA256:…",
  "connect": "share 192.168.1.20",
  "expires": "2026-11-21T12:00:00.000Z",
  "created": "2026-11-21T11:00:00.000Z"
}
```

The viewer can type `connect` directly into Quick Connect; compare the fingerprint when connecting for the first time.

Security:

- **"Allow sharing"** (Settings → "Sharing") must be turned on beforehand. An external call never turns it on by itself; otherwise an error appears and nothing is opened.
- A call with `--share` is always confirmed, with the note "Will be shared (access, validity)". With "Run exactly this call without asking in future" it becomes trusted; the share options are part of the trusted call, so a changed mode asks again.
- **Local shell with write access** (`ask` or `rw`): MacT-1000 always asks additionally, even for trusted calls – otherwise viewers work with your permissions on your computer.
- Better not to put `share-password` into links (`mact1000://…`): links easily end up in histories and chats. The generated password is in the clipboard or in the info file.

## Servers (TFTP, FTP, HTTP, SFTP/SCP)

Sidebar tab **Servers** (or ⌥⌘T / Alt+Shift+S, menu **View → Show servers**). Every server has its own card – clicking the header expands the settings, **Start**/**Stop** in the header starts or stops it directly. The servers only run while started and are stopped when MacT-1000 quits. At the bottom of the session list "Servers: FTP, SFTP/SCP" shows which are currently running.

For all servers:

- **Directory**, **port** and **address** (all networks, a specific interface or this computer only) are selectable; the settings are stored per computer (not in the network configuration).
- Access only within the selected directory (including subfolders). `..`, absolute paths and symlinks pointing outside are rejected.
- **Permissions:** the default is read-only. "Upload and create folders", "Overwrite existing" and "Delete and rename" can be enabled individually. Uploaded files only appear after the transfer is complete (before that as a hidden partial file).
- **Passwords** are stored encrypted locally; the field then shows "stored". Leave empty = keep using the stored password.
- **Transfers** list shared by all servers (labeled TFTP/FTP/HTTP/SFTP/SCP), including failed logins. The displayed address and sample commands can be copied with a click.
- On the first start the firewall (macOS or Windows) may ask whether incoming connections are allowed. If a port is in use (e.g. by the macOS services `tftpd` or "Remote Login" on port 22), a message appears – then choose another port.

| Server | Default port | Details |
|---|---|---|
| TFTP | 69 | RFC 1350 with options `blksize`, `tsize`, `timeout` (RFC 2347–2349), modes `octet` and `netascii`, files over 32 MB, retransmission on packet loss. No login. Example: `copy running-config tftp://<IP-of-the-computer>/` |
| FTP | 21 | User/password and/or anonymous login (anonymous read-only). Passive (PASV/EPSV) and active (PORT/EPRT), `LIST`/`NLST`/`MLSD`, resume (`REST`), create/delete folders, rename. Data connections only from/to the IP address of the logged-in client. Note: FTP transmits passwords unencrypted. Protocol replies to clients are in German. |
| HTTP | 8080 | Directory listing in the browser (can be turned off, then `index.html` is served), download with resume (Range), optional user/password (Basic Auth; empty user = no login). Upload via `PUT`/`POST` (`curl -T file.bin http://<IP>:8080/`) or by drag & drop in the directory listing, delete via `DELETE`. |
| SFTP/SCP | 2222 | Encrypted over SSH: SFTP and classic SCP (`scp -O`, as used by switches and routers), recursive as well. Login with user/password and/or public keys (field in `authorized_keys` format). Own host key (ed25519), generated on the first start and kept; the fingerprint is shown. No shell access – other commands are rejected. Examples: `sftp -P 2222 user@<IP>`, `scp -O -P 2222 file.bin user@<IP>:/` |

## File transfer (SCP)

In an SSH pane click **⇅** in the pane bar (or ⇧⌘F / Ctrl+Shift+D, or pane menu → "Transfer files (SCP)…"). On the left the tab **Files (SCP)** opens with the server's home directory.

- **Navigate:** double-click folders, ↰ = one level up, ⌂ = home, type a path at the top + Enter
- **In sync with the shell (default: on):** if you change the directory in the terminal with `cd`, the browser follows automatically. Toggle **⇄** in the toolbar (or ⋯ → "Keep in sync with the shell's directory", or Settings). The directory is detected via the OSC 7 path message, otherwise via the prompt line (`user@host:~/path$`, `root@host:/etc#`) or the window title. If the prompt does not show a path, use ⋯ → "Set up path message in the shell (bash/zsh)" – this applies to the running shell; add the same line to `~/.bashrc` or `~/.zshrc` permanently. If you navigate in the browser yourself, that view stays until the shell changes directory the next time. If the shell directory is not readable for the file browser (e.g. after `sudo -i` or ssh to another host), the previous list stays with a notice.
- **Jump directly to a file:** click into the list and type – e.g. `sum` selects the first entry starting with "sum" (otherwise the first one containing "sum"); after a one-second pause the search starts over, pressing the same key repeatedly cycles. Also: ↑/↓ select, Enter opens, ⌫ (Backspace) = one level up, Esc clears the selection.
- **Upload:** "↑ Up" (files and folders selectable) or drag files/folders from Finder/Explorer into the list – dropped on a folder they land there. Dropping files directly on the SSH terminal uploads into the current browser directory.
- **Drag out:** drag entries (also several selected ones, also folders) from the list into Finder/Explorer, onto the desktop or into another app. MacT-1000 first downloads them into a temporary folder; for small files dragging starts immediately as long as the mouse button stays pressed. If it is released earlier (large files), the entry appears under "Transfers" with "done – drag to the destination" and can be dragged from there. Dragging the same unchanged selection again uses the copy already downloaded.
- **Download:** select (⌘-click / ⇧-click, Windows: Ctrl+click / Shift+click for several) and "↓ Down" → download folder (default `~/Downloads`, changeable in Settings or under ⋯). Right-click → "Download to…" asks for the destination folder. Double-clicking a file downloads a temporary copy and opens it with the default app.
- **More actions (right-click):** rename, delete (recursive, with confirmation), copy path, change to this directory in the terminal (cd). Under ⋯: show hidden files.
- **Transfers** appear at the bottom with progress, speed and remaining time; running ones can be canceled with ×. Before overwriting existing files you are asked.

**Login (macOS):** terminal and file browser share one SSH connection (OpenSSH `ControlMaster`, sockets in `~/.mact1000/cm/`). If the terminal session is logged in, there is no second password/2FA prompt. If no session is open, MacT-1000 asks once in its own dialog for password or host key and keeps that connection open for up to 10 minutes without use; it is closed when MacT-1000 quits. Keys from the Keychain and ssh-agent are used as usual.

Per session (Edit session) there are two options:
- "Share connection with file browser (SCP)" (default: on) – turn off if your own `~/.ssh/config` already uses ControlMaster or there are problems.
- "Classic SCP protocol (scp -O)" – for devices without an SFTP subsystem (e.g. some switches, routers, Dropbear). The default is modern scp over SFTP.

**On Windows (SCP from 1.7.0):** Windows OpenSSH has no ControlMaster, so the file browser opens its own SSH connection (ssh2 library) and asks for password, passphrase or host key itself when needed; a stored session password (or the folder's default password) is used automatically. Keys from `%USERPROFILE%\.ssh` and the "OpenSSH Authentication Agent" service are used if it is running. Directories are listed via the shell as on the Mac; transfers use the classic SCP protocol (`scp -t`/`scp -f` on the server) – this also works on servers and devices without an SFTP subsystem. If the server offers no shell but SFTP, only listing is done via SFTP. Up to 1.6.0 the Windows version used SFTP throughout; if you need that, start MacT-1000 with the environment variable `MACT_FX_BACKEND=sftp`.

Note: the browser lists directories via `ls` in a POSIX shell on the server. On devices without a Unix shell (e.g. Cisco IOS) browsing does not work; there SCP is usually only usable via the device CLI anyway.

## Sharing panes (from 1.8.0)

A running pane (local shell, SSH, Telnet, serial, command) can be shared with other computers that also run MacT-1000 – for working together, support or training. The viewer sees the pane live and, with permission, can type as well. Mac and Windows can connect to each other.

Also from an external call: `mact1000 --ssh admin@10.0.0.2 --share` (see [Sharing directly](#sharing-directly---share-from-181)).

**Sharing:** pane menu (`⋯` at the top right of the pane) → **"Share session…"**. In the dialog:

- **Name** – shown in the viewer's pane header.
- **Password** – generated randomly (↻ for a new one, at least 4 characters) and copied to the clipboard when sharing. Pass it on through another channel (e.g. phone).
- **Access** – "Read only", "Read, write after my approval" or "Read and write without asking".
- **Valid** – until stopped or 1/4/8/24 hours; afterwards all viewers are disconnected.
- Below are the addresses of this computer, the port and the **fingerprint**.

The first time, tick **"Allow sharing panes on this computer"** (also in Settings → "Sharing"). The feature is off by default and no port is listening.

A shared pane has a turquoise frame and shows **"Shared · n"** in its header (n = viewers, "· writing" if someone has write access). Clicking it opens the manager: viewers with address and time, **Allow writing / Revoke write access**, **Disconnect**, change access, show or copy the password, **Stop sharing**. Closing the pane stops sharing; after "Reconnect" sharing continues with the new connection.

**Connecting (viewer):** Quick Connect `share 192.168.1.20` (other port: `share 192.168.1.20:7100`) or a saved session of type **"Share"** (computer, port, password, optionally share name and your own display name). On the first connection MacT-1000 asks whether the fingerprint shown is correct – compare it with the fingerprint in the share dialog on the other computer. It is remembered afterwards; if it changes later, the connection is refused (remove the entry under Settings → "Sharing" → "Known shares" if MacT-1000 was reinstalled there). If several shares with the same password run on that computer, you can choose one.

The viewer first receives the current screen including scrollback (up to 2000 lines), then everything live. **The shared pane determines the size**; if your own pane is smaller, scroll bars appear. Input without write access is not sent; a hint offers **"Request write access"** (also by clicking "Read only" in the header or via the pane menu). The person sharing then sees "… wants to write in this session" with **Allow / Deny** in the pane (denied automatically after 60 seconds). With "Read and write without asking", write access applies immediately. With write access the indicator turns orange; clicking it gives write access back.

**Security:**

- The connection uses SSH (ssh2 library) – encrypted, with a key per computer (ed25519) and fingerprint check. Viewers get no shell and no file access, only the one shared pane.
- Login only with the share password. After 5 wrong attempts within 10 minutes the address is blocked for 10 minutes; at most 20 viewers per share.
- Write access only if the person sharing allows it. For a **local shell** MacT-1000 warns explicitly: a viewer with write access then works with your permissions on your computer. In SSH/Telnet sessions they type with your login on the target device.
- Quitting MacT-1000 stops all shares; the quit confirmation lists running shares with viewers.
- Meant for your own network or VPN. Do not expose it directly to the internet; use e.g. a VPN or an SSH tunnel (`ssh -L 7022:localhost:7022 user@computer`, then `share localhost`).

**Settings → "Sharing":** allow sharing, **port** (default 7022), **network address** (empty = all; e.g. only the VPN address), your own name when watching, fingerprint of this computer, known shares of other computers. When sharing for the first time, the firewall (macOS or Windows) may ask whether to allow incoming connections; if the computer cannot be reached, allow port 7022/TCP in the firewall.

## Copy on select

Text selected with the mouse in a session window goes straight to the clipboard, briefly confirmed with "Copied to clipboard" (setting "Automatically copy selected text to the clipboard", default: on). Double-click selects a word, triple-click a line. In programs with mouse support (e.g. htop, mc, vim with mouse) hold ⌥ (Windows: Shift) while selecting.

## Macros

Macros send input depending on the terminal output – e.g. login on a switch, command sequences or recurring queries. Open via the **Macros** button in the toolbar, the **Macros** menu or the ⋯ menu of a pane.

**Steps** (executed in order):

| Step | Effect |
|---|---|
| Wait for output | Pauses until the text appears in the output (optionally a regular expression). Timeout in seconds (0 = unlimited), then abort or continue |
| Send | Sends text to the session, optionally with Enter. Escape characters: `\r` `\n` `\t` `\e` (Esc) `\xHH` (e.g. `\x03` = Ctrl+C) |
| Pause | Waits a fixed time in milliseconds |

**Connect before starting:** in the macro editor under "Connect before starting" choose a saved session (local shell, SSH, Telnet, serial – not RDP) and where it opens: in a new tab, split side by side or one above the other. When the macro starts (Macros menu, ⇧⌘M / Alt+Shift+M, manager) the connection is established first and the macro then runs in it – regardless of the active pane and of Multi-Input. Confirmation and variables are asked for beforehand; on "Cancel" no connection is opened. The macro reads along from the start of the connection; a typical sequence is e.g. `Wait for "password:"` → `Send {{Password}}` → `Wait for "#"` → commands. An autostart macro stored in the session is not started additionally. With autostart and auto-responses such a macro runs in the triggering pane without a new connection. If the session is deleted, the macro reports this at start.

**Confirm before starting:** tick "Confirm before starting" in the macro editor, optionally with your own notice text (e.g. "Caution: reloads the configuration"). Before every start a dialog then shows the target pane(s) and a preview of the steps; only after "Run" is anything sent. This also applies to autostart after connecting and to macros started by an auto-response – there the output is already read, but nothing is sent before confirmation. With several Multi-Input panes you are asked once for all.

**Variables:** `{{Name}}` in the send text is asked for at start (names containing "Pass", "Kennwort", "PIN", "Token" as a hidden field). The values are not stored.

**Loops:** in the macro editor add "+ Loop" (or change a step to "Loop" / "End of loop"). All steps between "Loop" and "End of loop" run once per value; ↑/↓ move steps into or out of the loop, the editor indents the body. Loops can be nested.

- **Numbers:** separated by comma, semicolon or space, ranges with a hyphen – e.g. `1,2,3 7-10` → 1, 2, 3, 7, 8, 9, 10. Descending `10-1`, with step `0-100/10`, with leading zeros `01-12` → 01 … 12.
- **Texts:** separated by commas, spaces at the edges are removed – e.g. `Gi1/0/1, Gi1/0/5, uplink`. A comma within a value as `\,`.
- **Usage:** in the body the current value is available as `{{Name}}`, `{{Name#}}` is the number of the iteration (1, 2, 3 …). This applies to "Send" and "Wait for output". Example: loop `{{Port}}` over `1-24` → `Send interface Gi1/0/{{Port}}` → `Wait for "(config-if)#"` → `Send shutdown` → End of loop.
- **Ask for values at start:** the value list may itself contain a variable, e.g. `{{Ports}}` – it is asked for at start like any other variable (input e.g. `3,5,9-12`).
- The editor shows the number of iterations next to every loop (tooltip: the values) and marks errors; invalid entries are rejected when saving, at runtime the macro stops with a message. The pane header shows the current value, e.g. `▶ Ports 3/5 · Port=7 (5/12)`. At most 10,000 values per loop.

**Recording:** in a connected pane press ⇧⌘R (Windows: Alt+Shift+R) or Macros → Start recording, work normally, press it again. MacT-1000 creates "Wait for <last displayed prompt>" + "Send <your input>" from it. Input after a password prompt (`Password:`, `Kennwort:` …) is **not** recorded but replaced by `{{Password}}` (German interface: `{{Passwort}}`). The result opens in the editor for checking and saving. During recording the pane shows "● Recording".

**Run:** Macros → ▶ Name (or ⇧⌘M / Alt+Shift+M). If Multi-Input is active with several panes, the macro runs in all selected panes at the same time. A running macro is shown with progress in the pane header – clicking it or ⌘. (Ctrl+.) stops it.

**Autostart:** in the session dialog choose a macro under "Macro after connecting" – it starts automatically on every (re)connection of this session, e.g. for login and basic configuration.

**Auto-responses:** Macros → Auto-responses… rules "if the output contains X → send Y" (or start a macro), permanently active in all or selected sessions (filter on parts of name/host/folder, several separated by commas). Examples: `--More--` → space without Enter, `(yes/no)?` → `yes`. A rule that triggers more than 25 times in 10 seconds is paused for the pane (protection against endless loops).

## Tabs and panes by drag & drop

- **Drag a tab into a split window:** grab the tab, hold it briefly over the target tab (which becomes active after about ½ s), then drag it to the left/right/top/bottom edge of a pane. The green marker shows where it will be inserted. All panes of the dragged tab move along with their running sessions, the source tab disappears.
- **Without a mouse:** right-click a tab → "Insert next to "…" (split)".
- **Move a single pane:** drag the pane by its header – onto the edge of another pane (also in another tab) or onto a free spot of the tab bar (= its own new tab).
- **Duplicate tab:** ⌥⇧⌘D (Windows: Alt+Shift+T), menu "View → Duplicate tab" or right-click the tab. A new tab with the same layout appears directly to the right; every session in it is reconnected (local shells start in the current directory). An autostart macro stored for a session runs again.
- **Reorder tabs:** drag a tab before or after another tab within the tab bar.

Sessions are not re-established in the process – SSH, Telnet and serial connections keep running without interruption.

## Passwords

- **Store:** the session dialog has a "Password" field for SSH and Telnet. The password is stored encrypted (Electron safeStorage; key in the macOS Keychain or protected by the Windows user account) and never ends up in plain text in the saved window layout.
- **SSH:** at the password prompt of the target host (`user@host's password:` or `Password:`) MacT-1000 enters the stored password once automatically. If it is rejected, a notice appears and you enter it manually. Prompts of jump hosts and key passphrases are not answered (passphrases on macOS: Keychain option).
- **Telnet:** user + password are entered at `login:` / `Password:`; the "Auto-login" checkbox is set automatically when you type a password.
- **Save after manual login:** if you log in manually with a password via SSH or Telnet, MacT-1000 shows at the top of the pane after a successful login: "Save password …?" with *Save* / *Not now* / *Never for this session*. For a Quick Connect connection the session is created with the password. If the password was asked for again directly (wrong), nothing is offered; `sudo` prompts are ignored. Can be turned off in Settings.
- **Default password per folder (from 1.7.0):** right-click a folder → **"Set default password…"**. It applies to all SSH and Telnet sessions in this folder and all its subfolders that have no password of their own – handy if e.g. all switches of a site share one password. If a subfolder has its own default password, that one applies (the nearest folder wins). A session's own password always takes precedence. Folders with a default password show the marker **PW** in the list; the session dialog shows "empty = default password of folder …" in the empty password field. It is stored encrypted like session passwords (macOS Keychain or Windows DPAPI), moves along when the folder is renamed or moved and is removed when the folder is deleted. The file browser uses it as well. It stays on the respective computer and is not distributed via the network folder; it is included in a configuration export with passwords. To change or remove it: right-click again → "Change default password…".
- **Keychain access (macOS):** since the app is not signed with an Apple Developer ID, after an update macOS may ask "MacT-1000 wants to access key "MacT-1000 Safe Storage"" – confirm with your Mac password and **Always Allow**. If access is denied, the passwords stay stored encrypted; the session shows "locked" and the password can be entered again.

## Keyboard shortcuts

On Windows, Ctrl+letter stays free for the shell (Ctrl+C, Ctrl+D, Ctrl+R …); program functions are on Ctrl+Shift or Alt+Shift. Ctrl+C copies when text is selected, Ctrl+V pastes. Tooltips and menus always show the shortcut of the running system.

| Function | Mac | Windows |
|---|---|---|
| New tab with local shell | ⌘T | Ctrl+Shift+T |
| New session | ⌘N | Ctrl+Shift+S |
| Quick Connect | ⌘K | Ctrl+Shift+K |
| Split vertically (side by side) | ⌘D | Ctrl+Shift+E |
| Split horizontally (one above the other) | ⇧⌘D | Ctrl+Shift+O |
| Duplicate session in a new pane | ⌥⌘D | Alt+Shift+D |
| Reconnect a disconnected session – if it is still active, it is duplicated in a new tab right next to it | ⌘R | Ctrl+Shift+R |
| Duplicate tab (same layout, all sessions reconnected) | ⌥⇧⌘D | Alt+Shift+T |
| Next / previous pane in the current tab | ⌘] / ⌘[ | Ctrl+Shift+N / Ctrl+Shift+P |
| Next / previous pane across all tabs (after the last pane of a tab it continues in the next tab) | ⌘→ / ⌘← | Alt+Shift+→ / Alt+Shift+← |
| Next / previous tab | ⇧⌘] / ⇧⌘[ | Ctrl+PgDn / Ctrl+PgUp (also Ctrl+Tab / Ctrl+Shift+Tab) |
| Tab 1–9 directly | ⌘1–9 | Alt+1–9 |
| Maximize pane | ⇧⌘↩ | Ctrl+Shift+X |
| Distribute panes evenly | ⌥⌘= | Ctrl+Shift+G |
| Multi-Input on/off | ⇧⌘I | Ctrl+Shift+I |
| Select all panes of the tab for Multi-Input | ⇧⌘A | Alt+Shift+A |
| Multi-Paste | ⇧⌘V | Ctrl+Shift+M |
| Run macro | ⇧⌘M | Alt+Shift+M |
| Start / stop macro recording | ⇧⌘R | Alt+Shift+R |
| Stop running macros | ⌘. | Ctrl+. |
| Copy / paste | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V |
| Select all | ⌘A | Ctrl+Shift+A |
| Find | ⌘F | Ctrl+Shift+F |
| Clear terminal | ⌘L | Ctrl+Shift+L |
| Close pane / tab | ⌘W / ⇧⌘W | Ctrl+Shift+W / Ctrl+Shift+Q |
| Sidebar on/off | ⌘B | Ctrl+Shift+B |
| File browser (SCP) for the active SSH pane | ⇧⌘F | Ctrl+Shift+D |
| Show servers (TFTP, FTP, HTTP, SFTP/SCP) | ⌥⌘T | Alt+Shift+S |
| Settings | ⌘, | Ctrl+, |
| Export entire configuration | ⇧⌘E | – (File menu) |
| Font size larger / smaller / default | ⌘+ / ⌘- / ⌘0 | Ctrl++ / Ctrl+- / Ctrl+0 |
| Confirm dialog | ⌘↩ | Ctrl+Enter |
| Word back / forward | ⌥← / ⌥→ | Ctrl+← / Ctrl+→ (depending on the shell) |
| Start / end of line | fn← / fn→ or Ctrl+A / Ctrl+E | Home / End or Ctrl+A / Ctrl+E |
| Full screen / developer tools | ⌃⌘F / ⌥⌘I | F11 / F12 |

Ended sessions can be reconnected with ⌘R or Ctrl+Shift+R (Enter deliberately does nothing, so that no accidental reconnect happens). If the connection in the active pane is still active, the same shortcut opens the connection additionally in a new tab directly to the right (local shells in the current directory); as a split pane use ⌥⌘D or Alt+Shift+D.

### Folders in the session list

- **Create:** right-click in the session list (empty area, a folder or a session) → "New folder…". New folders are empty at first and also remain when empty.
- **Move:** drag a session onto a folder (the folder is highlighted in blue). Dropping onto a session inside a folder works too. Dropping onto "Sessions (no folder)" or the empty area takes the session out of the folder. Alternatively right-click the session → "Move to folder…".
- **Subfolders:** right-click a folder → "New subfolder…" (the parent folder can also be chosen freely in the dialog). Can be nested to any depth, e.g. `Data center › Core › Switches`. In the session dialog the folder can also be typed as a path: `Data center/Core/Switches` – missing folders are created automatically. Folder names therefore must not contain "/".
- **Move folders:** dragging a folder onto another makes it a subfolder (with its content and subfolders); dragging onto "Sessions (no folder)" or right-click → "Move to top level" brings it up. Every folder can be collapsed individually; the number on the folder counts all sessions including subfolders.
- **Folder right-click:** open all as tiles (including subfolders), new session directly in this folder, import sessions from CSV into this folder, new subfolder, rename, set default password, delete. Renaming a parent folder updates all subfolders and sessions. When deleting, the contained sessions and subfolders are not deleted but moved one level up.
- Dragging sessions from the list onto a pane opens them.
- Empty folders are saved in the settings and included in the configuration export.

Confirmation when closing: while SSH, Telnet or serial connections are active, MacT-1000 asks before closing a pane, a tab or the window and before quitting (⌘Q or File → Quit). Local shells and RDP (external program) do not trigger a confirmation. The confirmation can be accepted with **Enter** (connection is disconnected and closed) or canceled with Esc. Can be turned off in Settings → "Ask before closing … while connections are active".

## Building it yourself

Requirement: Node.js 20+ (macOS: `brew install node`). Xcode or Visual Studio are not required – node-pty and serialport ship prebuilt binaries for macOS and Windows.

```bash
npm install
npm start                 # development mode
npm run dist:mac          # ZIPs for Apple Silicon and Intel -> dist/
npm run dist:win          # Windows: installer and portable EXE -> dist/
npm run dist:setup        # Windows installer only
npm run dist:portable     # portable EXE only
```

The Windows packages can also be built on macOS or Linux. For your own signature with an Apple Developer ID, enter the certificate name in `package.json` under `build.mac.identity` (instead of `null`).

## Structure

```
src/main.js        Electron main process, menu, IPC, language
src/sessions.js    Session manager, PTY for local shell / ssh / commands
src/scp.js         SCP file transfer, directory listing, shared SSH connection (macOS)
src/sftp.js        SSH login of the Windows file browser (ssh2) and SFTP fallback option
src/scp-win.js     File browser on Windows: listing via shell, transfer via SCP protocol
src/ssh-args.js    Argument helpers
src/telnet.js      Telnet client (RFC 854, NAWS, TTYPE)
src/serial.js      Serial console (serialport, /dev/cu.* or COM ports)
src/config-io.js   Export/import of the configuration (including password encryption)
src/rdp.js         RDP start via Windows App or FreeRDP (macOS) or mstsc.exe (Windows)
src/store.js       Sessions/settings (encrypted passwords), local or network drive
src/shared.js      Shared configuration: lock, monitoring, offline sync
src/merge3.js      3-way merge of simultaneous changes
src/tftp.js        TFTP server (RFC 1350, blksize/tsize/timeout)
src/srv-common.js  Common parts of the file servers: directory protection, transfer log
src/ftp-server.js  FTP server (active/passive, MLSD, REST)
src/http-server.js HTTP server (directory listing, Range, PUT/POST/DELETE, Basic Auth)
src/ssh-server.js  SFTP/SCP server (ssh2 library)
src/version.js     Version comparison for the configuration version
src/update.js      Query of the latest release on GitHub (update notice)
src/updater.js     Automatic update: selects the macOS or Windows variant
src/updater-mac.js Update on macOS: download, SHA-256 check, unpack, replace after quitting
src/updater-win.js Update on Windows: download installer, SHA-256 check, silent installation after quitting
src/launch.js      External calls: evaluate command line and mact1000:// links
src/share.js       Pane sharing: share service (SSH server, password, blocking, write access) and viewer connection
src/compat.js      Identifiers of earlier versions (data takeover, former links and formats)
build/bin/mact1000 Command-line tool (in the Mac app under Contents/Resources/bin)
build/installer.nsh Additions for the Windows installer (links, replacing WinT-1000)
beispiele/         Templates: Automator workflow, .command file, AppleScript (macOS), batch and PowerShell (Windows), CSV template for the session import
renderer/csv-import.js CSV import of sessions with folders and subfolders
renderer/share.js  Pane sharing: dialogs, header indicator, viewer management, write requests
renderer/i18n.js   Language switching English/German; renderer/i18n-en.js contains the English texts
renderer/          User interface: tabs, split layout, dialogs, file browser, servers tab, macros and loops, external calls (xterm.js)
test/              Unit, Telnet, SCP, server and end-to-end tests
```

Data is stored in `~/Library/Application Support/MacT-1000/` (macOS) or `%APPDATA%\MacT-1000` (Windows).

### Moving from WinT-1000 (Windows, up to 1.5.23)

- **Data:** on the first start MacT-1000 takes over sessions, folders, macros, settings, server settings and stored passwords from `%APPDATA%\WinT-1000` once. If `%APPDATA%\MacT-1000` already contains data, it is first backed up to `%APPDATA%\MacT-1000\Sicherung-vor-1.6.0`. The old folder remains unchanged.
- **Installer:** the setup variant removes an installed WinT-1000 (program files and shortcuts, not the data) and registers `mact1000://` and `wint1000://`.
- **Links and scripts:** `wint1000://` links keep working. In batch/PowerShell scripts adjust the path of the EXE (`…\Programs\MacT-1000\MacT-1000.exe`).
- **Shared network configuration:** a network folder created by WinT-1000 (`WinT-1000-config.json`) continues to be read and maintained; Macs and PCs thus share the same state.
- **Exports** from WinT-1000 can be imported.

### Moving from MacTerm (up to 1.4.0, macOS)

On the first start MacT-1000 automatically takes over sessions, settings, folders and layout from `~/Library/Application Support/MacTerm/`. Exception: **passwords stored in the app** – they are encrypted with a key bound to the app name and must be entered again once. Alternatively choose "Export configuration" with passwords in MacTerm and import it in MacT-1000. SSH key passphrases in the macOS Keychain are not affected. The old `MacTerm.app` can be deleted afterwards.

## Releases on GitHub

For the update check and the automatic update to work, create a release with the tag `v<version>` (e.g. `v1.8.1`) for every version in the repository [denkteich/MacT-1000](https://github.com/denkteich/MacT-1000) and attach these files (file names exactly like this):

| File | Purpose |
|---|---|
| `MacT-1000-<version>-arm64-mac.zip` | Apple Silicon – downloaded by the automatic update |
| `MacT-1000-<version>-x64-mac.zip` | Intel Macs – downloaded by the automatic update |
| `MacT-1000-<version>-setup.exe` | Windows installer – downloaded by the installed Windows version and installed silently |
| `MacT-1000-<version>-portable.exe` | Windows portable (manual) |

## Notes

- Testing was done only in a Linux test environment (user interface in macOS and Windows mode, workflows, update logic with a test server). A test on a real Mac and a real Windows PC is still pending – also for the installer, data takeover and automatic update.
- The firewall (macOS or Windows) may ask on the first start of a server (TFTP/FTP/HTTP/SFTP) whether incoming connections are allowed.
- Pane sharing: tested only within a test environment (sharing and viewer on the same computer via 127.0.0.1), not between two real computers on a network. The firewall may ask on first sharing as well.

## License

MacT-1000 is licensed under the [MIT License](LICENSE) – Copyright (c) 2026 Harald Thomas.

In short: using, copying, modifying and distributing (also commercially) is permitted as long as the copyright notice and the license text are retained. The software is provided without warranty.

Libraries used and their licenses (all MIT): Electron, xterm.js, node-pty, serialport, ssh2. Electron also ships the licenses of Chromium (`LICENSES.chromium.html` in the app package).
