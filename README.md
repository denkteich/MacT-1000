# MacT-1000

> Der Name spielt auf den T-1000 aus „Terminator 2“ an – den Terminator aus Flüssigmetall, der sich teilen und wieder zusammenfließen kann. Genau wie die Fenster von MacT-1000.

Terminal-Client für macOS – lokale Shell, SSH (mit SCP-Dateiübertragung), Telnet, serielle Konsole und RDP in einem Fenster, mit frei teilbaren Panes, Multi-Input und Multi-Paste.

## Installation (fertige App)

1. Passende ZIP-Datei entpacken:
   - `MacT-1000-1.5.1-arm64-mac.zip` – Apple Silicon (M1/M2/M3/M4)
   - `MacT-1000-1.5.1-x64-mac.zip` – Intel-Macs
2. `MacT-1000.app` nach `/Programme` ziehen.
3. Die App ist ad-hoc signiert, aber nicht von Apple notarisiert. Beim ersten Start daher einmalig im Terminal:
   ```bash
   find /Applications/MacT-1000.app -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
   ```
   Alternativ: Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.
   Meldet macOS „beschädigt“: `codesign --force --deep --sign - /Applications/MacT-1000.app`
4. Für serielle USB-Adapter (FTDI, Prolific, CH340, Silicon Labs) ggf. den Treiber des Herstellers installieren – viele laufen unter macOS ohne Treiber.

## Funktionen

| Bereich | Details |
|---|---|
| Lokale Shell | Login-Shell ($SHELL, z. B. zsh), Startverzeichnis, Startbefehl, ⌘D dupliziert inkl. aktuellem Verzeichnis |
| SSH-Schlüssel & Schlüsselbund | Option pro Session (Standard: an): Passphrase wird beim ersten Verbinden im macOS-Schlüsselbund gespeichert (`UseKeychain`/`AddKeysToAgent`) und danach automatisch genutzt. Zusätzlich: Ablage → „SSH-Schlüssel im Schlüsselbund hinterlegen…“ und beim Start `ssh-add --apple-load-keychain` |
| SSH | Nutzt das System-`ssh` → `~/.ssh/config`, Schlüssel, ssh-agent, Jump-Hosts (-J), Port-Weiterleitungen (L/R/D), Agent-/X11-Forwarding, Keepalive, Option für alte Algorithmen (ältere Switches) |
| SCP-Dateiübertragung | Seitenleisten-Tab „Dateien (SCP)“ folgt dem aktiven SSH-Pane: Verzeichnisse durchsuchen, Hoch-/Herunterladen von Dateien und Ordnern mit Fortschritt, Drag & Drop aus dem Finder, Ordner anlegen, umbenennen, löschen, „Im Terminal hierhin wechseln (cd)“. Nutzt die Anmeldung der Terminal-Session mit (siehe unten) |
| Telnet | Eigene Implementierung mit Optionsverhandlung (ECHO, SGA, TTYPE, NAWS = Fenstergröße), Auto-Login, CR/LF-Modus, Raw-TCP für Konsolenserver, Break/Interrupt |
| Seriell | Alle `/dev/cu.*`-Ports, Baudrate 300–921600, Datenbits, Parität, Stoppbits, RTS/CTS bzw. XON/XOFF, Break-Signal (z. B. Cisco ROMMON), DTR/RTS umschalten, lokales Echo |
| RDP | Startet „Windows App“ (Microsoft, App Store) über eine erzeugte .rdp-Datei oder FreeRDP (`brew install freerdp`, Passwortabfrage im Pane). Auflösung, Multi-Monitor, Zwischenablage, Laufwerke, RD-Gateway, Admin-Session |
| Split-Panes | Jedes Pane beliebig vertikal (nebeneinander) und horizontal (untereinander) teilbar, Trenner per Maus ziehen (Doppelklick = 50/50), Pane maximieren, gleichmäßig verteilen, Pane in neuen Tab verschieben. Tabs und Panes per Drag & Drop neu anordnen (siehe unten) |
| Multi-Input | Tastatureingaben gehen gleichzeitig an alle markierten Panes – über Tabs hinweg. Pro Pane über das ⇶-Symbol ein-/ausschließbar. Markierte Panes sind orange umrandet |
| Multi-Paste | Text/Befehle an ausgewählte Panes senden: als Block (Bracketed Paste) oder zeilenweise mit Verzögerung, Platzhalter `{{name}}`, `{{host}}`, `{{user}}`, `{{n}}`, Verlauf der letzten 20 Einträge |
| Session-Verwaltung | Seitenleiste mit Ordnern, Farben, Filter; Passwörter verschlüsselt über den macOS-Schlüsselbund; Export/Import der gesamten Konfiguration (siehe unten) |
| Komfort | Quick Connect (`user@host`, `telnet host 2001`, `/dev/cu.usbserial 115200`, `rdp admin@host`), Drag & Drop von Sessions auf Panes (Rand = geteilt öffnen), Ordner „Alle als Kacheln öffnen“, Suche im Puffer, Puffer als Log speichern, Rechtsklick kopieren/einfügen wie MobaXterm, 4 Farbschemata, Layout-Wiederherstellung |

## Konfiguration exportieren / importieren

Menü **Datei → Gesamte Konfiguration exportieren…** (⇧⌘E) oder in den Einstellungen (⚙). Die JSON-Datei enthält:

- das komplette Adressbuch: alle Sessions mit Ordnern, Farben und sämtlichen Verbindungsoptionen (SSH, Telnet, Seriell, RDP, Befehl)
- alle Einstellungen (Schrift, Farbschema, Verhalten …)
- Tab-/Split-Layout, eingeklappte Ordner und Multi-Paste-Verlauf
- optional die gespeicherten Passwörter – nur verschlüsselt (AES-256-GCM, Schlüssel per scrypt aus einem Export-Passwort)

**Datei → Konfiguration importieren…** zeigt den Inhalt der Datei und bietet „Zusammenführen“ (gleiche Sessions werden aktualisiert, neue ergänzt, lokale Passwörter bleiben erhalten) oder „Ersetzen“. Einstellungen und Layout lassen sich einzeln abwählen; ein importiertes Layout öffnet sich beim nächsten Start. Ältere Sessions-Exporte (reine JSON-Liste) werden ebenfalls erkannt. SSH-Schlüssel-Passphrasen aus dem macOS-Schlüsselbund werden nicht exportiert.

„Nur Adressbuch exportieren (ohne Passwörter)…“ erzeugt wie bisher eine einfache Sessions-Liste.

## Dateiübertragung per SCP

In einem SSH-Pane auf **⇅** in der Pane-Leiste klicken (oder ⇧⌘F, oder Pane-Menü → „Dateien übertragen (SCP)…“). Links öffnet sich der Tab **Dateien (SCP)** mit dem Home-Verzeichnis des Servers.

- **Navigieren:** Doppelklick auf Ordner, ↰ = eine Ebene höher, ⌂ = Home, Pfad oben eintippen + Enter
- **Hochladen:** „↑ Hoch“ (Dateien und Ordner wählbar) oder Dateien/Ordner aus dem Finder in die Liste ziehen – auf einen Ordner gezogen landen sie dort. Dateien direkt aufs SSH-Terminal ziehen lädt ins aktuelle Browser-Verzeichnis hoch.
- **Herunterladen:** markieren (⌘-Klick / ⇧-Klick für mehrere) und „↓ Runter“ → Download-Ordner (Standard `~/Downloads`, änderbar in den Einstellungen oder unter ⋯). Rechtsklick → „Herunterladen nach…“ fragt den Zielordner ab. Doppelklick auf eine Datei lädt eine temporäre Kopie und öffnet sie mit der Standard-App.
- **Weitere Aktionen (Rechtsklick):** Umbenennen, Löschen (rekursiv, mit Rückfrage), Pfad kopieren, Im Terminal hierhin wechseln (cd). Unter ⋯: versteckte Dateien anzeigen.
- **Übertragungen** erscheinen unten mit Fortschritt, Geschwindigkeit und Restzeit; laufende lassen sich mit × abbrechen. Vor dem Überschreiben vorhandener Dateien wird gefragt.

**Anmeldung:** Terminal und Datei-Browser teilen sich eine SSH-Verbindung (OpenSSH-`ControlMaster`, Sockets unter `~/.mact1000/cm/`). Ist die Terminal-Session angemeldet, gibt es keine zweite Passwort-/2FA-Abfrage. Ist keine Session offen, fragt MacT-1000 einmalig in einem eigenen Dialog nach Passwort bzw. Host-Schlüssel und hält diese Verbindung bis zu 10 Minuten ohne Nutzung offen; beim Beenden von MacT-1000 wird sie geschlossen. Schlüssel aus Schlüsselbund und ssh-agent werden wie gewohnt genutzt.

Pro Session (Session bearbeiten) gibt es dazu zwei Optionen:
- „Verbindung mit Datei-Browser (SCP) teilen“ (Standard: an) – ausschalten, falls die eigene `~/.ssh/config` bereits ControlMaster nutzt oder es Probleme gibt.
- „Klassisches SCP-Protokoll (scp -O)“ – für Geräte ohne SFTP-Subsystem (z. B. manche Switches, Router, Dropbear). Standard ist das moderne scp über SFTP.

Hinweis: Der Browser listet Verzeichnisse per `ls` in einer POSIX-Shell auf dem Server. Auf Geräten ohne Unix-Shell (z. B. Cisco IOS) funktioniert das Durchsuchen nicht; dort ist SCP meist ohnehin nur über die Geräte-CLI nutzbar.

## Tabs und Panes per Drag & Drop

- **Tab in ein geteiltes Fenster ziehen:** Tab anfassen, kurz über den Ziel-Tab halten (dieser wird nach ca. ½ s aktiv), dann auf den linken/rechten/oberen/unteren Rand eines Panes ziehen. Die grüne Markierung zeigt, wo eingefügt wird. Alle Panes des gezogenen Tabs wandern samt laufender Sessions mit, der Quell-Tab verschwindet.
- **Ohne Maus:** Rechtsklick auf einen Tab → „Neben „…“ einfügen (geteilt)“.
- **Einzelnes Pane verschieben:** Pane an seiner Kopfzeile ziehen – auf den Rand eines anderen Panes (auch in einem anderen Tab) oder auf eine freie Stelle der Tab-Leiste (= eigener neuer Tab).
- **Tabs umsortieren:** Tab innerhalb der Tab-Leiste vor oder hinter einen anderen Tab ziehen.

Sessions werden dabei nicht neu aufgebaut – SSH-, Telnet- und serielle Verbindungen laufen unterbrechungsfrei weiter.

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| ⌘T | Neuer Tab mit lokaler Shell |
| ⌘N | Neue Session |
| ⌘K | Quick Connect |
| ⌘D | Vertikal teilen (nebeneinander) |
| ⇧⌘D | Horizontal teilen (untereinander) |
| ⌥⌘D | Session in neuem Pane duplizieren |
| ⌘] / ⌘[ | Nächstes / vorheriges Pane |
| ⇧⌘] / ⇧⌘[ | Nächster / vorheriger Tab, ⌘1–9 direkt |
| ⇧⌘↩ | Pane maximieren |
| ⌥⌘= | Panes gleichmäßig verteilen |
| ⇧⌘I | Multi-Input ein/aus |
| ⇧⌘A | Alle Panes des Tabs für Multi-Input wählen |
| ⇧⌘V | Multi-Paste |
| ⌘F | Suchen |
| ⌘L | Terminal leeren |
| ⌘W / ⇧⌘W | Pane / Tab schließen |
| ⌘B | Seitenleiste ein/aus |
| ⇧⌘F | Datei-Browser (SCP) für das aktive SSH-Pane |
| ⌘+ / ⌘- / ⌘0 | Schriftgröße |
| ⌘← / ⌘→ / ⌥← / ⌥→ | Zeilenanfang/-ende, Wort zurück/vor |
| ⌘{# of Tab} | Move between Tabs |

Beendete Sessions lassen sich mit Enter neu verbinden.

## Selbst bauen

Voraussetzung: Node.js 20+ (`brew install node`). Xcode ist nicht nötig – node-pty und serialport bringen fertige macOS-Binaries mit.

```bash
npm install
npm start                 # Entwicklungsmodus
npm run dist:arm64        # App für Apple Silicon -> dist/
npm run dist:x64          # App für Intel
npm run dist:universal    # Universal-Binary
```

Für eine eigene Signatur mit Apple-Developer-ID in `package.json` unter `build.mac.identity` den Zertifikatsnamen eintragen (statt `null`).

## Aufbau

```
src/main.js       Electron-Hauptprozess, Menü, IPC
src/sessions.js   Session-Manager, PTY für lokale Shell / ssh / Befehle
src/scp.js        SCP-Dateiübertragung, Verzeichnisliste, gemeinsame SSH-Verbindung
src/ssh-args.js   Argument-Hilfsfunktionen
src/telnet.js     Telnet-Client (RFC 854, NAWS, TTYPE)
src/serial.js     Serielle Konsole (serialport)
src/config-io.js  Export/Import der Konfiguration (inkl. Passwort-Verschlüsselung)
src/rdp.js        RDP-Start über Windows App oder FreeRDP
src/store.js      Sessions/Einstellungen (verschlüsselte Passwörter)
renderer/         Oberfläche: Tabs, Split-Layout, Dialoge, Datei-Browser (xterm.js)
test/             Unit-, Telnet-, SCP- und End-to-End-Tests
```

Daten liegen unter `~/Library/Application Support/MacT-1000/`.

### Umstieg von MacTerm (bis 1.4.0)

Beim ersten Start übernimmt MacT-1000 automatisch Sessions, Einstellungen, Ordner und Layout aus `~/Library/Application Support/MacTerm/`. Ausnahme: **in der App gespeicherte Passwörter** – sie sind mit einem Schlüssel verschlüsselt, der an den App-Namen gebunden ist, und müssen einmalig neu eingegeben werden. Alternativ in MacTerm „Konfiguration exportieren“ mit Passwörtern wählen und in MacT-1000 importieren. SSH-Schlüssel-Passphrasen im macOS-Schlüsselbund sind nicht betroffen. Die alte `MacTerm.app` kann danach gelöscht werden.
