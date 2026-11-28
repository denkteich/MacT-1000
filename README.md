# MacT-1000

> Der Name spielt auf den T-1000 aus „Terminator 2“ an – den Terminator aus Flüssigmetall, der sich teilen und wieder zusammenfließen kann. Genau wie die Fenster von MacT-1000.

Version 1.8.7 · Copyright © 2026 Harald Thomas · MIT-Lizenz · [English version](README.en.md)

Terminal-Client für **macOS und Windows** – lokale Shell, SSH (mit SCP-Dateiübertragung), Telnet, serielle Konsole und RDP in einem Fenster, mit frei teilbaren Panes, Multi-Input und Multi-Paste. Dazu eingebaute TFTP-, FTP-, HTTP- und SFTP/SCP-Server für Firmware-Updates und Konfigurations-Backups. Oberfläche auf Deutsch oder Englisch.

Projekt und Updates: [github.com/denkteich/MacT-1000](https://github.com/denkteich/MacT-1000)

> **Ab 1.6.0 ein gemeinsames Projekt:** Die Windows-Ausgabe hieß bis 1.5.23 **WinT-1000** und läuft jetzt ebenfalls unter dem Namen MacT-1000 – gleicher Quellcode, gleiche Funktionen, gleiche Versionsnummern. Wie die Daten übernommen werden, steht unter „Umstieg von WinT-1000“.

## Sprache

Die Oberfläche gibt es auf **Deutsch** und **Englisch** – Menüs, Dialoge, Hinweise, Tooltips und Meldungen im Terminal.

- **Standard „Automatisch (System)“:** MacT-1000 übernimmt die Sprache des Betriebssystems (macOS: Systemeinstellungen → Allgemein → Sprache & Region; Windows: Einstellungen → Zeit und Sprache). Deutsch bei deutscher Systemsprache, sonst Englisch.
- **Umschalten:** Einstellungen (⚙) → ganz oben **„Sprache / Language“** → Automatisch (System), Deutsch oder English. Die Umstellung gilt sofort, ohne Neustart – auch für das Menü.
- Die Einstellung gilt nur für diesen Rechner und wird nicht über die Netzwerk-Konfiguration geteilt.
- Selbst vergebene Namen (Sessions, Ordner, Makros, Layouts) werden nicht übersetzt. Die Werte für Aufrufe von außen gibt es in beiden Sprachen (`--slot oben` = `--slot top`, `--busy neu` = `--busy new`).
- Datum und Zahlen folgen der gewählten Sprache.

## Installation unter macOS

1. Passende ZIP-Datei entpacken:
   - `MacT-1000-1.8.7-arm64-mac.zip` – Apple Silicon (M1/M2/M3/M4)
   - `MacT-1000-1.8.7-x64-mac.zip` – Intel-Macs
2. `MacT-1000.app` nach `/Programme` ziehen.
3. Die App ist ad-hoc signiert, aber nicht von Apple notarisiert. Beim ersten Start daher einmalig im Terminal:
   ```bash
   find /Applications/MacT-1000.app -exec xattr -d com.apple.quarantine {} \; 2>/dev/null
   ```
   Alternativ: Systemeinstellungen → Datenschutz & Sicherheit → „Trotzdem öffnen“.
   Meldet macOS „beschädigt“: `codesign --force --deep --sign - /Applications/MacT-1000.app`
4. Für serielle USB-Adapter (FTDI, Prolific, CH340, Silicon Labs) ggf. den Treiber des Herstellers installieren – viele laufen unter macOS ohne Treiber.

Daten liegen unter `~/Library/Application Support/MacT-1000/`.

## Installation unter Windows

Windows 10/11 (64 Bit). Zwei Varianten:

| | Installierbar (Setup) | Portable |
|---|---|---|
| Datei | `MacT-1000-1.8.7-setup.exe` | `MacT-1000-1.8.7-portable.exe` |
| Installation | Assistent (Deutsch/Englisch); Standardordner `%LOCALAPPDATA%\Programs\MacT-1000`, Ordner wählbar; Startmenü- und Desktop-Verknüpfung | keine – EXE an einen beliebigen Ort kopieren (z. B. `C:\Tools`, USB-Stick) und starten |
| Administratorrechte | nicht nötig (Installation nur für das eigene Benutzerkonto) | nicht nötig |
| `mact1000://`-Links | werden bei der Installation eingerichtet (frühere `wint1000://`-Links ebenfalls) | im Fenster „Aufruf von außen“ → „Links für diese EXE einrichten“ |
| Updates | Hinweis; „Herunterladen“ lädt den neuen Installer im Browser, danach MacT-1000 beenden und den Installer starten | Hinweis; „Herunterladen“ lädt die neue portable EXE im Browser, danach die alte EXE ersetzen |
| Deinstallation | Einstellungen → Apps → MacT-1000 | EXE löschen |

Beide Varianten sind nicht signiert. Windows SmartScreen meldet beim ersten Start ggf. „Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“.

Einstellungen, Sessions und Makros liegen bei beiden Varianten unter `%APPDATA%\MacT-1000` – sie bleiben beim Update und beim Wechsel zwischen Setup und portabler EXE erhalten. Die portable EXE entpackt sich beim Start in einen temporären Ordner, der erste Start dauert daher einige Sekunden.

### Bedienung unter Windows

Funktionen und Oberfläche sind dieselben wie unter macOS. Unterschiede:

| Bereich | macOS | Windows |
|---|---|---|
| Lokale Shell | Login-Shell (`$SHELL`, z. B. zsh) | PowerShell 7 (`pwsh`), sonst Windows PowerShell, sonst `cmd.exe`; eigene Shell in den Einstellungen |
| SSH | System-`ssh` | eingebauter OpenSSH-Client (`C:\Windows\System32\OpenSSH\ssh.exe`); fehlt er: Einstellungen → System → Optionale Features → „OpenSSH-Client“ |
| Datei-Browser | per SCP über die Verbindung des Terminals | per SCP (eigene Verbindung, fragt Passwort/Passphrase selbst ab; ab 1.7.0, vorher SFTP) |
| RDP | „Windows App“ oder FreeRDP | Remotedesktopverbindung (`mstsc.exe`) |
| Seriell | `/dev/cu.*` | COM-Ports, z. B. `COM3 115200` im Quick Connect |
| Passwörter | verschlüsselt, Schlüssel im macOS-Schlüsselbund | verschlüsselt mit der Windows-Benutzeranmeldung (DPAPI) |
| Menü | MacT-1000, Ablage, Bearbeiten, Makros, Ansicht, Fenster | Datei, Bearbeiten, Makros, Ansicht, Hilfe (Einstellungen unter Datei, Über/Updates unter Hilfe) |
| Tastenkürzel | ⌘-Kombinationen | Strg+Umschalt bzw. Alt+Umschalt, damit Strg+Buchstabe für die Shell frei bleibt – siehe „Tastenkürzel“ |
| Dateimanager | Finder | Explorer |

## Funktionen

| Bereich | Details |
|---|---|
| Lokale Shell | Login-Shell ($SHELL, z. B. zsh), Startverzeichnis, Startbefehl, ⌘D dupliziert inkl. aktuellem Verzeichnis |
| SSH-Schlüssel & Schlüsselbund | Option pro Session (Standard: an): Passphrase wird beim ersten Verbinden im macOS-Schlüsselbund gespeichert (`UseKeychain`/`AddKeysToAgent`) und danach automatisch genutzt. Zusätzlich: Ablage → „SSH-Schlüssel im Schlüsselbund hinterlegen…“ und beim Start `ssh-add --apple-load-keychain` |
| SSH | Nutzt das System-`ssh` → `~/.ssh/config`, Schlüssel, ssh-agent, Jump-Hosts (-J), Port-Weiterleitungen (L/R/D), Agent-/X11-Forwarding, Keepalive, Option für alte Algorithmen (ältere Switches), gespeichertes Passwort wird beim Login-Prompt automatisch eingegeben (siehe „Passwörter“) |
| SCP-Dateiübertragung | Seitenleisten-Tab „Dateien (SCP)“ folgt dem aktiven SSH-Pane: Verzeichnisse durchsuchen, Hoch-/Herunterladen von Dateien und Ordnern mit Fortschritt, Drag & Drop aus dem Finder, Ordner anlegen, umbenennen, löschen, „Im Terminal hierhin wechseln (cd)“. Nutzt die Anmeldung der Terminal-Session mit (siehe unten) |
| Server (TFTP, FTP, HTTP, SFTP/SCP) | Seitenleisten-Tab „Server“: vier Dateiserver, jeder einzeln konfigurierbar und startbar – Verzeichnis, Port, Netzwerkadresse, Benutzer/Passwort, Rechte (Lesen, Hochladen, Überschreiben, Löschen). Gemeinsame Liste der Übertragungen mit Fortschritt, z. B. für Firmware-Updates und Konfigurations-Backups von Switches/Routern |
| Aufruf von außen | Start aus Automator, Kurzbefehlen, AppleScript oder Terminal (`mact1000 --local --run "uptime"`) und über `mact1000://`-Links – lokale Shell, SSH, Telnet, Seriell, RDP, gespeicherte Sessions und Ordner, mit Befehlen und Makros, Ausgabe in eine Datei und automatischem Schließen danach (`--log`, `--close`, `--quit`) sowie festen Plätzen in einem geteilten Tab (`--layout core --slot oben`, dann `--slot unten`); Befehle nur nach Rückfrage |
| Update | Prüft beim Start und alle 6 Stunden das neueste Release auf GitHub, fragt vorher: jetzt installieren (Windows: herunterladen), später erinnern oder Version überspringen; macOS lädt dann (SHA-256 geprüft), installiert nach Rückfrage und startet neu; Windows startet nur den Download im Browser |
| Telnet | Eigene Implementierung mit Optionsverhandlung (ECHO, SGA, TTYPE, NAWS = Fenstergröße), Auto-Login, CR/LF-Modus, Raw-TCP für Konsolenserver, Break/Interrupt. Ist ein Passwort hinterlegt, ist Auto-Login automatisch aktiv |
| Seriell | Alle `/dev/cu.*`-Ports, Baudrate 300–921600, Datenbits, Parität, Stoppbits, RTS/CTS bzw. XON/XOFF, Break-Signal (z. B. Cisco ROMMON), DTR/RTS umschalten, lokales Echo |
| RDP | Startet „Windows App“ (Microsoft, App Store) über eine erzeugte .rdp-Datei oder FreeRDP (`brew install freerdp`, Passwortabfrage im Pane). Auflösung, Multi-Monitor, Zwischenablage, Laufwerke, RD-Gateway, Admin-Session |
| Split-Panes | Jedes Pane beliebig vertikal (nebeneinander) und horizontal (untereinander) teilbar, Trenner per Maus ziehen (Doppelklick = 50/50), Pane maximieren, gleichmäßig verteilen, Pane in neuen Tab verschieben. Tabs und Panes per Drag & Drop neu anordnen (siehe unten) |
| Multi-Input | Tastatureingaben gehen gleichzeitig an alle markierten Panes – über Tabs hinweg. Pro Pane über das ⇶-Symbol ein-/ausschließbar. Markierte Panes sind orange umrandet |
| Makros | Abläufe „warte auf Ausgabe → sende Eingabe“, manuell erstellen oder aufzeichnen, Variablen mit Abfrage beim Start, Schleifen über Zahlen (1,2,3 7-10) oder Texte, Autostart nach dem Verbinden, Ausführung auf mehreren Panes; Auto-Antworten auf bestimmte Ausgaben (siehe unten) |
| Multi-Paste | Text/Befehle an ausgewählte Panes senden: als Block (Bracketed Paste) oder zeilenweise mit Verzögerung, Platzhalter `{{name}}`, `{{host}}`, `{{user}}`, `{{n}}`, Verlauf der letzten 20 Einträge |
| Pane-Freigabe | Ein Pane für andere Rechner mit MacT-1000 freigeben (Pane-Menü → „Session freigeben…“): verschlüsselt per SSH, Passwort, nur lesen oder Schreiben nach Bestätigung, Gültigkeit, Zuschauerliste mit Trennen; Zuschauer verbinden sich per Quick Connect `share host` (siehe unten) |
| Session-Verwaltung | Seitenleiste mit Ordnern und beliebig tiefen Unterordnern (Rechtsklick → „Neuer Ordner…“ / „Neuer Unterordner…“, Sessions und Ordner per Drag & Drop verschieben), Farben, Filter; Passwörter verschlüsselt über den macOS-Schlüsselbund, Standard-Passwort pro Ordner; CSV-Import mit Unterordnern; Export/Import der gesamten Konfiguration; optional gemeinsame Konfiguration auf einem Netzlaufwerk für alle Macs (siehe unten) |
| Komfort | Quick Connect (`user@host`, `telnet host 2001`, `/dev/cu.usbserial 115200`, `rdp admin@host`), Drag & Drop von Sessions auf Panes (Rand = geteilt öffnen), Ordner „Alle als Kacheln öffnen“, Suche im Puffer, Puffer als Log speichern, Rechtsklick kopieren/einfügen, 4 Farbschemata, Layout-Wiederherstellung |

## Konfiguration exportieren / importieren

Menü **Datei → Gesamte Konfiguration exportieren…** (⇧⌘E) oder in den Einstellungen (⚙). Die JSON-Datei enthält:

- das komplette Adressbuch: alle Sessions mit Ordnern, Farben und sämtlichen Verbindungsoptionen (SSH, Telnet, Seriell, RDP, Befehl)
- alle Einstellungen (Schrift, Farbschema, Verhalten …) inklusive Makros und Auto-Antworten
- Tab-/Split-Layout, eingeklappte Ordner und Multi-Paste-Verlauf
- optional die gespeicherten Passwörter – nur verschlüsselt (AES-256-GCM, Schlüssel per scrypt aus einem Export-Passwort)

**Datei → Konfiguration importieren…** zeigt den Inhalt der Datei und bietet „Zusammenführen“ (gleiche Sessions werden aktualisiert, neue ergänzt, lokale Passwörter bleiben erhalten) oder „Ersetzen“. Einstellungen und Layout lassen sich einzeln abwählen; ein importiertes Layout öffnet sich beim nächsten Start. Ältere Sessions-Exporte (reine JSON-Liste) werden ebenfalls erkannt. SSH-Schlüssel-Passphrasen aus dem macOS-Schlüsselbund werden nicht exportiert.

„Nur Adressbuch exportieren (ohne Passwörter)…“ erzeugt wie bisher eine einfache Sessions-Liste.

Werden Passwörter mit exportiert, sind auch die Standard-Passwörter der Ordner enthalten (ab 1.7.0, ebenfalls verschlüsselt).

## Sitzungsexport importieren (ab 1.8.6)

Unter **Ablage** (macOS) bzw. **Datei** (Windows) → **Sitzungsexport importieren** den textbasierten Konfigurationsexport öffnen. Der Dateidialog zeigt zuerst Konfigurationsexporte; für `.mxtsessions` und `.ini` den Filter **Sitzungsexport** wählen. Der Aufruf über **Einstellungen → Sitzungsexport importieren…** bleibt verfügbar. Die Vorschau zeigt den festen Importordner und die erkannten SSH-, Telnet-, RDP- und seriellen Sitzungen. Unterordner bleiben erhalten, vorhandene Einträge werden übersprungen und es werden keine Verbindungen automatisch geöffnet.

Für die Passwortübernahme beim Erstellen des vollständigen Exports die gespeicherten Passwörter und Zugangsdaten einschließen. Das Master-Passwort nur im lokalen Importdialog eingeben und **Importvorschau prüfen** anklicken. Nur eindeutig zugeordnete Zugangsdaten werden übernommen, und nur wenn ein verschlüsselter Passwortspeicher verfügbar ist. Ohne Master-Passwort werden nur Sitzungen importiert. Das Exportformat kann das Master-Passwort nicht zuverlässig verifizieren; nach dem Import die Anmeldung prüfen. Externe RDP-Clients können weiterhin separat nach dem Passwort fragen.

Nicht übernommen werden Registry-Daten, vollständig verschlüsselte Container, Programmeinstellungen, Befehle, Schlüsseldateien oder Sprungserver. Den vollständigen Export als sensible Datei behandeln und nicht weitergeben.

## Sessions aus CSV importieren (ab 1.7.0)

Menü **Datei → Sessions aus CSV importieren…**, in den Einstellungen (⚙) oder per Rechtsklick auf einen Ordner → **„Sessions aus CSV hierher importieren…“**. So lassen sich Lesezeichen aus Excel, einer Inventarliste oder einem anderen Programm übernehmen – samt Ordnern und Unterordnern.

- **Spalten:** werden an der Kopfzeile erkannt (deutsch oder englisch, Groß-/Kleinschreibung egal): `Ordner`, `Name`, `Typ`, `Host`, `Port`, `Benutzer`, `Passwort`, `Schlüsseldatei`, `Jump-Host`, `Schnittstelle` (seriell, z. B. `COM3` oder `/dev/cu.usbserial`), `Baudrate`, `Domäne` (RDP), `Farbe`, `Standardpasswort`. Englisch z. B. `Folder`, `Hostname`, `Protocol`, `User`, `Password`. Im Dialog lässt sich jede Spalte von Hand zuordnen oder ignorieren; ohne Kopfzeile gilt die Reihenfolge Name, Typ, Host, Port, Benutzer, Ordner, Passwort.
- **Unterordner:** Im Feld `Ordner` mit `/` trennen – auch `\` oder `>` werden erkannt: `Rechenzentrum/Core/Switche` legt drei verschachtelte Ordner an. Fehlende Ordner entstehen automatisch. Mit **Zielordner** landet der ganze Import unter einem vorhandenen Ordner.
- **Typ:** `SSH`, `Telnet`, `RDP`, `Seriell` (auch `serial`, `COM`, `Konsole`), `Lokal`. Leere Felder bekommen den gewählten Standardtyp. Der Port ist optional (22/23/3389), `user@host:port` im Host-Feld wird zerlegt.
- **Ordnerzeilen:** Eine Zeile mit Typ `Ordner` legt einen (auch leeren) Ordner an; steht dort ein Passwort oder `Standardpasswort`, wird es das Standard-Passwort dieses Ordners (siehe „Passwörter“).
- **Trennzeichen und Zeichensatz:** Semikolon, Komma, Tabulator oder `|` werden automatisch erkannt, Anführungszeichen wie in Excel. UTF-8 (mit/ohne BOM), UTF-16 und Windows-1252 (Excel-Export mit Umlauten) werden gelesen.
- **Vorschau:** zeigt vor dem Import, was neu angelegt, aktualisiert oder übersprungen wird und welche Zeilen Fehler haben (z. B. fehlender Host). Bereits vorhandene Sessions (gleicher Ordner, Name, Typ, Host, Port, Benutzer) werden wahlweise übersprungen, aktualisiert oder trotzdem hinzugefügt.
- Passwörter aus der CSV werden verschlüsselt gespeichert. Die CSV-Datei danach am besten löschen.
- **Vorlage:** „Vorlage speichern…“ im Dialog oder `beispiele/sessions-import.csv` (englisch: `sessions-import-en.csv`):

```
Ordner;Name;Typ;Host;Port;Benutzer;Passwort;Schlüsseldatei;Baudrate;Standardpasswort
Rechenzentrum;;Ordner;;;;;;;GeheimesRZ-Passwort
Rechenzentrum/Core/Switche;core-sw01;SSH;10.0.0.1;22;admin;;;;
Rechenzentrum/Core/Router;edge-rt01;Telnet;10.0.1.1;23;admin;EigenesPasswort;;;
Labor/Konsolen;Konsole COM3;Seriell;COM3;;;;;9600;
```

## Gemeinsame Konfiguration auf einem Netzlaufwerk

Menü **Datei → Netzwerk-Konfiguration (gemeinsam nutzen)…** oder in den Einstellungen (⚙). Einen Ordner auf einem eingebundenen Netzlaufwerk wählen (z. B. `/Volumes/Team/MacT-1000`, SMB oder NFS) – jeder Mac, der denselben Ordner verwendet, arbeitet mit derselben Konfiguration.

- **Gemeinsam:** Adressbuch (alle Sessions mit allen Optionen), Session-Ordner, Makros und Auto-Antworten. Optional zusätzlich die allgemeinen Einstellungen (Schrift, Farbschema, Cursor, Verhalten).
- **Immer lokal:** Fenstergröße, Seitenleiste, Standard-Shell, Download-Ordner, Tab-/Split-Layout, Multi-Paste-Verlauf.
- **Sperre nur beim Ändern:** Lesen braucht keine Sperre. Speichert ein Mac eine Änderung, legt er kurz `MacT-1000-config.lock` an (atomar, mit Rechnername), liest die aktuelle Datei, führt zusammen, schreibt die neue Revision und gibt die Sperre sofort wieder frei. Ein anderer Mac wartet in der Zeit bis zu 10 s. Verwaiste Sperren (z. B. nach einem Absturz) werden nach 60 s entfernt.
- **Automatisch mitbekommen:** Jeder Mac prüft die Datei alle 2 Sekunden. Ändert ein anderer Rechner etwas, werden Adressbuch, Ordner und Makros sofort neu geladen; ein Hinweis zeigt, von welchem Rechner die Änderung kam. Offene Verbindungen bleiben unberührt, geänderte Verbindungsdaten gelten ab dem nächsten Verbinden.
- **Gleichzeitige Änderungen gehen nicht verloren:** Es wird pro Session, pro Makro und pro Ordner zusammengeführt. Ändern zwei Rechner dieselbe Session, werden unterschiedliche Felder beide übernommen; nur bei demselben Feld gewinnt die zuletzt gespeicherte Änderung.
- **Netzlaufwerk nicht erreichbar:** MacT-1000 arbeitet mit dem zuletzt bekannten Stand weiter, Änderungen werden lokal vorgemerkt (Anzeige „Netz: ausstehend“ unten in der Seitenleiste) und beim nächsten Kontakt automatisch abgeglichen.
- **Passwörter:** Standardmäßig bleiben gespeicherte Passwörter auf jedem Mac lokal (Schlüsselbund-verschlüsselt). Mit einer **Team-Passphrase** (auf allen Macs gleich eintragen) werden sie zusätzlich AES-256-GCM-verschlüsselt in der gemeinsamen Datei abgelegt. Macs ohne Passphrase sehen die Passwörter nicht, überschreiben sie aber auch nicht.
- Beim Aktivieren mit vorhandener Datei: **Zusammenführen**, **Datei übernehmen** oder **Lokale Konfiguration hochladen**. Vor jeder Änderung wird die vorige Version mit Datum und Uhrzeit im Unterordner `MacT-1000-Backups/` gesichert, z. B. `MacT-1000-config_2026-11-08_14-30-05_rev42.json`.
- **Backups behalten**: einstellbar im Dialog Netzwerk-Konfiguration (Standard **15**, `0` = keine Backups, max. 500). Ältere Backups werden automatisch gelöscht. Der Wert gilt für alle Rechner. **Im Finder zeigen** öffnet den Backup-Ordner.
- Wiederherstellen: gewünschtes Backup als `MacT-1000-config.json` in den Netzwerkordner zurückkopieren – alle Rechner übernehmen es automatisch.
- **Trennen** übernimmt den aktuellen gemeinsamen Stand als lokale Konfiguration dieses Macs.

## Konfigurationsversion

Jede gespeicherte Konfiguration enthält die MacT-1000-Version, mit der sie geschrieben wurde – lokal (`config-meta.json`), in der Netzwerk-Datei (`appVersion`) und im Export. Zusätzlich wird die **neueste Version** vermerkt, die die Konfiguration je bearbeitet hat; so bleibt der Hinweis auch dann bestehen, wenn danach ein Mac mit älterer Version speichert.

- Ist die geladene Konfiguration **neuer als die laufende MacT-1000-Version**, erscheint oben ein gelber Hinweis mit **Details** und **Ausblenden** (merkt sich die Kombination aus Konfigurations- und Programmversion). Bei der Netzwerk-Konfiguration wird das auch geprüft, wenn ein anderer Rechner mit einer neueren Version speichert; die Anzeige unten in der Seitenleiste lautet dann „Netz: neuere Version“.
- **MacT-1000 → Konfigurationsversion…** (oder Einstellungen → „Version und Updates prüfen…“) zeigt, mit welcher Version die aktuelle Konfiguration geschrieben wurde, und vergleicht die laufende Version mit dem neuesten Release auf GitHub (siehe unten).
- Beim Import einer Export-Datei aus einer neueren Version und beim Verbinden mit einem Netzwerk-Ordner, dessen Datei neuer ist, erscheint ebenfalls ein Hinweis.
- Konfigurationen aus Versionen bis 1.5.13 enthalten noch keine lokale Kennung und werden als „unbekannt (vor 1.5.14)“ angezeigt.

## Neue Versionen (Update-Hinweis und automatisches Update)

MacT-1000 fragt kurz nach dem Start und danach alle 6 Stunden das neueste Release auf GitHub ab ([github.com/denkteich/MacT-1000/releases](https://github.com/denkteich/MacT-1000/releases), „latest“ – Vorabversionen und Entwürfe zählen nicht). Der Start wird dadurch nicht verzögert; ohne Internet passiert einfach nichts.

- Ist dort eine **neuere Version** als die laufende, erscheint oben ein blauer Hinweis „Neue Version verfügbar: MacT-1000 x.y.z“ mit **Jetzt aktualisieren**, dem Link **Release-Seite** (öffnet die Release-Seite im Browser), **Was ist neu?** (Release-Beschreibung), **Später** (bis zum nächsten Start) und **Überspringen** (diese Version nicht mehr melden; eine noch neuere wird wieder angezeigt).
- **MacT-1000 → Nach Updates suchen…** prüft sofort und zeigt das Ergebnis im Fenster „Version und Konfiguration“: neuestes Release mit Link und Datum, Vergleich mit der laufenden Version („Aktuell“, „Neue Version verfügbar“ oder „Diese Version ist neuer als das letzte Release“) und Zeitpunkt der Prüfung. Schlägt die Prüfung fehl, steht dort der Grund; der zuletzt bekannte Stand bleibt sichtbar.
- Ist die geladene **Konfiguration neuer** als die laufende Version und gibt es ein passendes Release, enthält auch der gelbe Konfigurations-Hinweis einen Link zum Download.
- Abfrage über die GitHub-API; ist deren Limit erreicht (60 Abfragen pro Stunde und IP-Adresse), wird die Version über die Weiterleitung der Release-Seite ermittelt. Gesendet wird nur eine normale Anfrage mit der Kennung `MacT-1000/<Version>`, keine weiteren Daten.
- Abschalten: Einstellungen → „Beim Start und alle 6 Stunden auf GitHub nach einer neuen MacT-1000-Version suchen“ (gilt nur für diesen Mac). „Nach Updates suchen…“ funktioniert weiterhin manuell.

### Automatisches Update (ab 1.5.18)

1. Wird eine neuere Version gefunden, fragt MacT-1000 zuerst (Fenster „Neue Version: MacT-1000 x.y.z“ mit der Release-Beschreibung) – geladen wird noch nichts:
   - **Jetzt installieren:** Das Update wird geladen (weiter mit Schritt 2).
   - **Später erinnern:** Nichts wird geladen, der Hinweis verschwindet. Erneut gefragt wird beim nächsten Start von MacT-1000 oder, wenn das Programm durchläuft, nach 24 Stunden.
   - **Diese Version überspringen:** Diese Version wird nicht mehr gemeldet; erst eine noch neuere Version erscheint wieder. Über **Nach Updates suchen…** lässt sie sich trotzdem jederzeit installieren.

   Danach lädt MacT-1000 im Hintergrund das passende Paket aus dem Release (`MacT-1000-<Version>-arm64-mac.zip` für Apple Silicon bzw. `…-x64-mac.zip` für Intel; auch unter Rosetta wird das arm64-Paket gewählt). Der Hinweis zeigt den Fortschritt („wird geladen … 45 % (40,1 von 98,0 MB)“) und **Abbrechen**.
2. Geprüft werden Größe und **SHA-256-Prüfsumme** (von GitHub zu jedem Release-Paket veröffentlicht) sowie die Versionsnummer in der `Info.plist` der entpackten App. Stimmt etwas nicht, wird das Update verworfen und der Grund angezeigt (**Erneut versuchen** / Release-Seite). Heruntergeladen wird nur von github.com.
3. Ist alles in Ordnung, fragt MacT-1000: „Jetzt installieren und neu starten?“ – mit Hinweis auf noch aktive Verbindungen.
   - **Jetzt neu starten:** MacT-1000 beendet sich, ein kleines Hilfsskript tauscht `MacT-1000.app` aus (die alte Version wird erst gelöscht, wenn die neue an ihrem Platz ist, bei einem Fehler wird sie wiederhergestellt) und startet die neue Version. Danach erscheint „MacT-1000 wurde von a auf b aktualisiert“.
   - **Später:** Das Update wird beim nächsten normalen Beenden installiert (ohne Neustart). Bis dahin steht im grünen Hinweis bzw. im Fenster „Version und Konfiguration“ **Neu starten und installieren**.
4. Gehört der Programmordner nicht dem angemeldeten Benutzer (z. B. Standardbenutzer ohne Schreibrecht in `/Programme`), fragt macOS beim Austausch nach dem **Administrator-Passwort**.

Hinweise:

- Das automatische Update funktioniert nur, wenn die App aus einem beschreibbaren Ordner läuft (am besten `/Programme`). Wird sie direkt aus „Downloads“ gestartet, verlagert macOS sie in einen schreibgeschützten Quarantäne-Ort – dann erscheint ein Hinweis, die App zuerst nach „Programme“ zu verschieben. Von einem Disk-Image oder im Entwicklungsmodus (`npm start`) gibt es nur den Hinweis mit Link.
- Das neue Paket ist wie bisher nur ad-hoc signiert; die Quarantäne-Markierung wird beim Austausch entfernt, damit kein Gatekeeper-Dialog erscheint.
- Releases müssen die Pakete unter genau diesen Dateinamen enthalten, sonst bleibt es beim Hinweis mit Link.
- Abschalten: Einstellungen → „Bei neuen Versionen nachfragen … und installieren“ (dann erscheint statt der Frage nur der blaue Hinweis, geladen wird erst nach Klick auf **Jetzt aktualisieren**, beim Beenden wird nichts installiert).
- Arbeitsordner und Protokoll: `~/Library/Application Support/MacT-1000/updates/` (`install.log`). Schlägt die Installation fehl, zeigt MacT-1000 beim nächsten Start die letzten Protokollzeilen.
- Versionen vor 1.5.18 können sich nicht selbst aktualisieren – 1.5.18 einmal von Hand installieren.

### Updates unter Windows

Ab 1.8.4 gibt es unter Windows kein automatisches Update mehr, nur noch den Hinweis auf eine neue Version mit dem Knopf **Herunterladen** (im Fenster, im blauen Hinweis und unter Hilfe → Nach Updates suchen…). MacT-1000 lädt, ersetzt und installiert selbst nichts.

- **Installierte Version (Setup):** **Herunterladen** startet im Standard-Browser den Download von `MacT-1000-<Version>-setup.exe` aus dem Release. Danach MacT-1000 beenden und den Installer starten; Einstellungen und Sessions bleiben erhalten.
- **Portable EXE:** **Herunterladen** startet den Download von `MacT-1000-<Version>-portable.exe`. Danach MacT-1000 beenden und die alte EXE durch die neue ersetzen.
- Fehlt die Datei im Release, öffnet sich stattdessen die Release-Seite.
- **Später erinnern** und **Diese Version überspringen** funktionieren wie unter macOS.
- Reste früherer automatischer Updates (`%APPDATA%\MacT-1000\updates`) werden beim Start entfernt.
- Installationen der früheren WinT-1000 (bis 1.5.23) finden das Update auf MacT-1000 über ihr bisheriges Release-Verzeichnis, sofern es dort bereitgestellt ist (siehe „Releases auf GitHub“).

## Aufruf von außen (Automator, Terminal, Links)

MacT-1000 lässt sich aus Automator, Kurzbefehlen, AppleScript oder dem Terminal starten und dabei steuern: Verbindung öffnen, Befehle ausführen, Makro starten. Läuft MacT-1000 schon, öffnet sich ein neuer Tab im vorhandenen Fenster (es gibt immer nur eine Instanz). Übersicht mit kopierbaren Beispielen: **MacT-1000 → Aufruf von außen (Automator, Terminal)…**

### Kommandozeilen-Werkzeug `mact1000`

Liegt in der App unter `MacT-1000.app/Contents/Resources/bin/mact1000`. Im Fenster „Aufruf von außen“ installiert **Befehl „mact1000“ installieren…** einen Verweis nach `/usr/local/bin/mact1000` (fragt bei Bedarf nach dem Administrator-Passwort); danach reicht im Terminal `mact1000 …`. Ohne Installation funktioniert auch `open -n -a MacT-1000 --args …`.

```
mact1000 --local --run "cd ~/Projekte" --run "git status"
mact1000 --local --cwd ~/Downloads
mact1000 --ssh admin@10.0.0.1 --run "show version" --split right
mact1000 --telnet 10.0.0.2:23 --title "Konsole Switch 2"
mact1000 --serial /dev/cu.usbserial-1410:115200
mact1000 --session "Rechenzentrum/core-sw01" --macro "Backup" --var ziel=10.0.0.5
mact1000 --folder "Rechenzentrum" --multi
mact1000 --ssh admin@10.0.0.1 --ssh admin@10.0.0.2 --tile --multi
mact1000 --ssh admin@10.0.0.1 --run "show running-config" --log ~/Logs/core-sw01.log --close 3
mact1000 --local --run "brew update" --quit
mact1000 --help
```

| Option | Bedeutung |
|---|---|
| `--local [BEFEHL]` | Lokale Shell (Standard-Shell aus den Einstellungen); ein direkt folgender Befehl entspricht `--run` |
| `--shell PFAD` | Lokale Shell mit bestimmter Shell, z. B. `/bin/zsh` |
| `--ssh [user@]host[:port]`, `--telnet host[:port]`, `--rdp [user@]host[:port]`, `--serial /dev/…[:baud]` | Neue Verbindung |
| `--connect "Zeile"` | Wie das Quick-Connect-Feld, z. B. `"ssh -J bastion admin@10.0.0.1"` |
| `--session "Ordner/Name"` | Gespeicherte Session (Name genügt, wenn er eindeutig ist; Passwort, Schlüssel und Makro der Session werden genutzt) |
| `--folder "Ordner"` | Alle Sessions des Ordners (inkl. Unterordner) als Kacheln in einem Tab; mit `--tabs` jede in einem eigenen Tab |
| `--run BEFEHL` | Befehl ausführen (mehrfach möglich; vor jedem Befehl wird auf den Prompt gewartet) |
| `--macro NAME`, `--var Name=Wert` | Gespeichertes Makro nach den Befehlen starten; fehlende Eingaben werden abgefragt |
| `--cwd ORDNER` | Startverzeichnis der lokalen Shell |
| `--title NAME` | Titel des Panes |
| `--split right\|down\|tab\|here` | Neben/unter dem aktiven Pane öffnen, neuer Tab (Standard) oder im aktiven Pane, wenn dort keine Verbindung läuft |
| `--layout NAME`, `--slot PLATZ`, `--grid RASTER`, `--busy WAS` | In einen festen Platz eines geteilten Tabs öffnen, siehe „Feste Plätze im geteilten Fenster“ |
| `--prompt REGEX` | Eigenes Prompt-Muster, auf das vor jedem Befehl gewartet wird (Standard: Zeile endet auf `$ # > % ]`) |
| `--close [SEK]` | Pane nach dem letzten Befehl bzw. Makro schließen: erst auf den Prompt warten (höchstens 10 Minuten), dann schließen, sobald SEK Sekunden keine Ausgabe mehr kam (Standard 3, auch Bruchteile wie `0.5`). Beendet ein Befehl die Verbindung selbst (z. B. `exit`), schließt das Pane sofort. Bei Fehlern (Verbindung abgelehnt, Anmeldung fehlgeschlagen) bleibt es mit der Meldung offen |
| `--log DATEI` | Ausgabe des Panes ohne Farbcodes an DATEI anhängen (vollständiger Pfad oder `~/…`; im Terminal auch relativ zum aktuellen Ordner). Ordner werden angelegt, jeder Lauf beginnt mit einer Kopfzeile mit Datum und Ziel |
| `--tile` | Alle Ziele dieses Aufrufs als Kacheln in einem Tab |
| `--multi` | Danach Multi-Input für den Tab einschalten |
| `--quit` | Alle Ziele wie mit `--close` schließen und danach MacT-1000 beenden – aber nur, wenn keine anderen Sessions oder Server mehr laufen |

Mehrere Ziele in einem Aufruf sind möglich; `--run`, `--macro`, `--var`, `--cwd`, `--title`, `--split`, `--layout`, `--slot`, `--grid`, `--busy`, `--prompt`, `--close` und `--log` gelten jeweils für das Ziel davor. Passwörter werden bewusst nicht als Argument angenommen – dafür gespeicherte Sessions, Schlüssel oder den Schlüsselbund verwenden.

### Feste Plätze im geteilten Fenster (ab 1.5.22)

Damit mehrere getrennte Aufrufe nacheinander in dasselbe geteilte Fenster kommen – z. B. der erste oben, der nächste unten –, bekommt der Tab einen Namen und jedes Ziel einen Platz:

```
mact1000 --ssh admin@10.0.0.1 --layout core --slot oben
mact1000 --ssh admin@10.0.0.2 --layout core --slot unten
```

| Option | Bedeutung |
|---|---|
| `--layout NAME` | Name des Layout-Tabs. Gibt es ihn noch nicht, wird er angelegt und gleich passend geteilt; leere Plätze zeigen „Wartet: unten“. Danach findet jeder Aufruf den Tab über den Namen – egal, welcher Tab oder welches Pane gerade aktiv ist. Ohne Angabe heißt das Layout „Layout“ |
| `--slot PLATZ` | `oben`, `unten` (Raster oben/unten), `links`, `rechts` (links/rechts), `oben-links`, `oben-rechts`, `unten-links`, `unten-rechts` (2×2), `1`–`4` (Reihenfolge wie beim Lesen) oder `next` = nächster freier Platz. Englische Namen (`top`, `bottom`, `left`, `right`, `tl` …) gehen auch. Ohne Angabe: `next` |
| `--grid RASTER` | `2h` = oben/unten, `2v` = links/rechts, `4` = 2×2. Nur nötig bei `next` oder Zahlen – sonst ergibt es sich aus dem Platz. Gilt nur beim Anlegen; ein vorhandener Layout-Tab behält sein Raster |
| `--busy WAS` | Wenn im Platz schon eine Session läuft: `fragen` (Standard), `ersetzen` (bisherige Session beenden), `neu` (Platz zusätzlich teilen, bisherige läuft weiter), `abbrechen` (nichts öffnen) |

Verhalten im Einzelnen:

- Frei ist ein Platz, solange er wartet oder seine Session beendet ist; beendete Sessions werden ohne Rückfrage ersetzt.
- `next` füllt zuerst wartende, dann beendete und dann geschlossene Plätze; sind alle belegt, öffnet der Aufruf einen neuen Tab.
- Wurde ein Platz geschlossen (auch durch `--close`), legt der nächste Aufruf für diesen Platz ihn an der richtigen Stelle wieder an. Wird der ganze Tab geschlossen, beginnt das Layout beim nächsten Aufruf von vorn.
- In wartenden Plätzen kann man auch selbst eine Verbindung öffnen – dann ist der Platz belegt.
- `--multi` schaltet Multi-Input für alle Bereiche des Layout-Tabs ein.
- Mit „Tabs und Split-Layout beim Start wiederherstellen“ bleiben Layout-Name und Plätze auch nach einem Neustart erhalten.
- Rückfrage und Hilfe zeigen den Platz mit an, z. B. „Layout „core“ · Platz unten“.

Ganz ohne zusätzliche Parameter geht es mit der Einstellung **Aufrufe von außen ohne Platzangabe** (Einstellungen): `oben/unten`, `links/rechts` oder `2×2`. Dann landen alle Aufrufe ohne `--split`, `--slot` oder `--layout` der Reihe nach im Layout-Tab „Aufrufe“.

### Links `mact1000://`

Dieselben Möglichkeiten als Link – z. B. für Kurzbefehle („URL öffnen“), AppleScript (`open location`), Notizen oder ein internes Wiki:

```
mact1000://local?run=uptime&run=df%20-h
mact1000://ssh/admin@10.0.0.1?run=show%20version&split=right
mact1000://session/Rechenzentrum/core-sw01?macro=Backup&var=ziel%3D10.0.0.5
mact1000://folder/Rechenzentrum?multi=1
mact1000://ssh/admin@10.0.0.1?run=show%20version&close=3&log=~/Logs/sw.log
mact1000://ssh/admin@10.0.0.2?layout=core&slot=unten
mact1000://help
```

Parameter wie bei der Kommandozeile ohne `--` (`run`, `macro`, `var`, `cwd`, `title`, `split`, `layout`, `slot`, `grid`, `busy`, `prompt`, `close`, `log`, `tile`, `multi`, `tabs`, `quit`); Leerzeichen als `%20`. Das Schema wird von macOS registriert, sobald die App einmal gestartet wurde.

### In Automator

1. Automator öffnen → **Arbeitsablauf** (oder **Schnellaktion** für das Dienste-Menü bzw. eine Tastenkombination) → Aktion **Shell-Skript ausführen**.
2. Befehl eintragen, z. B. `/Applications/MacT-1000.app/Contents/Resources/bin/mact1000 --local --run "uptime"` (oder kurz `mact1000 …`, wenn installiert).
3. Soll das Fenster danach wieder zugehen: `--close` (nur das Pane) oder `--quit` (MacT-1000 ganz beenden) anhängen, für die Ausgabe zusätzlich `--log ~/Logs/name.log`.
4. Ausführen. Fertige Vorlage: `beispiele/MacT-1000 Befehle ausführen.workflow` (außerdem eine `.command`-Datei für den Finder und ein AppleScript).

### Unter Windows

Alle Optionen gelten genauso. Statt `mact1000` wird die EXE aufgerufen; das Fenster „Aufruf von außen“ (Menü Hilfe) zeigt fertige Befehle mit dem Pfad der laufenden EXE. Beispiele für die installierte Version:

```bat
set M="%LOCALAPPDATA%\Programs\MacT-1000\MacT-1000.exe"
%M% --local --run "ipconfig"
%M% --ssh admin@10.0.0.1 --run "show version" --split right
%M% --serial COM3:115200
%M% --folder Rechenzentrum --multi
%M% --ssh admin@10.0.0.1 --run "show running-config" --log "%USERPROFILE%\Logs\core-sw01.log" --close 3
%M% --ssh admin@10.0.0.2 --layout core --slot unten
%M% --local --run "ipconfig /all" --quit
```

- `--log DATEI`: vollständiger Pfad nötig, z. B. `C:\Logs\sw.log`, `\\server\freigabe\sw.log` oder `~\Logs\sw.log` (`~` = Benutzerordner).
- `--close` und `--log` sind bei RDP nicht möglich (eigenes Programm).
- Links: `mact1000://ssh/admin@10.0.0.1?run=show%20version&close=3`; frühere `wint1000://`-Links funktionieren weiter.
- Vorlagen im Ordner `beispiele`: `MacT-1000-Beispiel.cmd` (Batch) und `MacT-1000-Beispiel.ps1` (PowerShell). Für Verknüpfungen: Rechtsklick auf den Desktop → Neu → Verknüpfung → einen der Befehle als Ziel. Für zeitgesteuerte Abläufe die Aufgabenplanung mit demselben Befehl verwenden.

### Sicherheit

- Aufrufe, die nur eine Verbindung oder eine Shell öffnen, laufen sofort.
- Enthält ein Aufruf **Befehle**, ein **Makro**, eine **Protokolldatei** (`--log`), eine eigene Shell oder zusätzliche ssh-Argumente (`--connect "ssh -o …"`), zeigt MacT-1000 vorher genau an, was ausgeführt wird, und fragt nach. So kann z. B. ein Link auf einer Webseite nichts unbemerkt ausführen.
- **Genau diesen Aufruf künftig ohne Rückfrage ausführen** merkt sich einen Fingerabdruck (SHA-256) des kompletten Aufrufs – ändert sich ein Befehl oder Ziel, wird wieder gefragt. Vertraute Aufrufe stehen im Fenster „Aufruf von außen“ und lassen sich dort entfernen (gespeichert nur auf diesem Mac).
- Unbekannte Sessions, Makros, Optionen oder ungültige Ziele: Es wird nichts geöffnet, stattdessen erscheint eine Fehlermeldung.
- Abschalten: Einstellungen → „Aufrufe von außen erlauben …“.

### Direkt freigeben (--share, ab 1.8.1)

Mit `--share` wird das aufgerufene Pane gleich nach dem Verbinden freigegeben (siehe [Pane-Freigabe](#pane-freigabe-ab-180)) – z. B. aus einem Automator-Ablauf oder Skript, das danach die Verbindungsdaten an den Kollegen weitergibt.

```
mact1000 --ssh admin@10.0.0.2 --share
mact1000 --session "Labor/Core-Switch" --share --share-mode ask --share-expires 60 --share-info ~/freigabe.json
mact1000://ssh/admin@10.0.0.2?share=1&share-mode=ask
"C:\Program Files\MacT-1000\MacT-1000.exe" --ssh admin@10.0.0.2 --share --share-info %USERPROFILE%\freigabe.json
```

| Option | Bedeutung |
|---|---|
| `--share` | Pane nach dem Verbinden freigeben. Gilt für das Ziel davor (wie `--run`); `--share nein` schaltet es wieder ab |
| `--share-mode MODUS` | `ro` = nur lesen (Standard), `ask` = Schreiben nach Bestätigung, `rw` = Lesen und Schreiben ohne Rückfrage (auch `lesen`, `fragen`, `schreiben`) |
| `--share-password PW` | Passwort der Freigabe (4–128 Zeichen). Ohne Angabe wird es zufällig erzeugt und in die Zwischenablage kopiert |
| `--share-name NAME` | Name, den der Zuschauer sieht. Ohne Angabe: Titel des Panes |
| `--share-expires MINUTEN` | Freigabe endet nach so vielen Minuten (höchstens 10080 = 7 Tage); `0` = bis zum Beenden (Standard) |
| `--share-info DATEI` | Verbindungsdaten als JSON in diese Datei schreiben (vollständiger Pfad, `~` erlaubt, Ordner werden angelegt, nur für den eigenen Benutzer lesbar) |
| `--share-confirm nein` | Ohne Rückfrage freigeben, auch mit Schreibrecht und für die lokale Shell (ab 1.8.2, siehe unten). Nur über die Kommandozeile und nur, wenn die Einstellung dafür eingeschaltet ist |

Jede `--share-*`-Option schaltet `--share` mit ein. Möglich bei lokaler Shell, SSH, Telnet, Seriell, Befehl und gespeicherten Sessions dieser Typen – nicht bei RDP und nicht für ganze Ordner (`--folder`).

Inhalt der Info-Datei:

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

`connect` kann der Zuschauer direkt in Quick Connect eingeben; den Fingerprint beim ersten Verbinden damit vergleichen.

Sicherheit:

- **„Freigaben erlauben“** (Einstellungen → „Freigaben“) muss vorher eingeschaltet sein. Ein Aufruf von außen schaltet es nie selbst ein; sonst erscheint ein Fehler und es wird nichts geöffnet.
- Ein Aufruf mit `--share` wird immer bestätigt, mit dem Hinweis „Wird freigegeben (Zugriff, Gültigkeit)“. Mit „Genau diesen Aufruf künftig ohne Rückfrage ausführen“ wird er vertraut; die Freigabe-Optionen gehören zum vertrauten Aufruf, ein geänderter Modus fragt also wieder nach.
- **Lokale Shell mit Schreibrecht** (`ask` oder `rw`): Hier fragt MacT-1000 immer zusätzlich nach, auch bei vertrauten Aufrufen – Zuschauer arbeiten sonst mit deinen Rechten auf deinem Rechner.
- **Ohne Rückfrage (ab 1.8.2):** In den Einstellungen → „Freigaben“ das Häkchen **„Aufrufe von außen dürfen ohne Rückfrage freigeben“** setzen (Standard: aus, gilt nur für diesen Rechner und wird nicht über die Netzwerk-Konfiguration verteilt). Dann gibt `--share-confirm nein` ohne jede Rückfrage frei – auch `--share-mode rw` bei einer lokalen Shell:

  ```
  mact1000 --local --share --share-mode rw --share-confirm nein --share-info ~/freigabe.json
  "C:\Program Files\MacT-1000\MacT-1000.exe" --ssh admin@10.0.0.2 --share-mode rw --share-confirm nein
  ```

  Ohne die Einstellung erscheint ein Fehler und es wird nichts geöffnet. In Links (`mact1000://…?share-confirm=nein`) ist die Option nie erlaubt, weil jede Webseite einen Link auslösen kann. Enthält der Aufruf zusätzlich Befehle (`--run`) oder ein Makro, kommt für diese weiterhin die normale Rückfrage (es sei denn, der Aufruf ist vertraut); nur die Fragen zur Freigabe entfallen. Im Pane erscheint die Zeile „Ohne Rückfrage freigegeben (Aufruf von außen)“, der türkisfarbene Rahmen zeigt die Freigabe wie gewohnt. Nur einschalten, wenn ausschließlich eigene Skripte MacT-1000 aufrufen.
- Bei Links (`mact1000://…`) besser kein `share-password` angeben: Links landen leicht in Verläufen und Chats. Das automatisch erzeugte Passwort steht in der Zwischenablage bzw. in der Info-Datei.

## Server (TFTP, FTP, HTTP, SFTP/SCP)

Seitenleisten-Tab **Server** (oder ⌥⌘T, Menü **Ansicht → Server anzeigen**). Jeder Server hat eine eigene Karte – Klick auf die Kopfzeile klappt die Einstellungen auf, **Start**/**Stopp** in der Kopfzeile startet oder stoppt ihn direkt. Die Server laufen nur, solange sie gestartet sind, und werden beim Beenden von MacT-1000 gestoppt. Unten in der Session-Liste zeigt „Server: FTP, SFTP/SCP“ an, welche gerade laufen.

Für alle Server gilt:

- **Verzeichnis**, **Port** und **Adresse** (alle Netzwerke, eine bestimmte Schnittstelle oder nur dieser Mac) sind wählbar; die Einstellungen werden pro Mac gespeichert (nicht in der Netzwerk-Konfiguration).
- Zugriff nur innerhalb des gewählten Verzeichnisses (inkl. Unterordnern). `..`, absolute Pfade und Symlinks nach außen werden abgewiesen.
- **Rechte:** Standard ist nur Lesen. „Hochladen und Ordner anlegen“, „Vorhandene überschreiben“ und „Löschen und Umbenennen“ lassen sich einzeln freigeben. Hochgeladene Dateien erscheinen erst nach vollständiger Übertragung (vorher als versteckte Teildatei).
- **Passwörter** werden lokal verschlüsselt gespeichert (macOS-Schlüsselbund); das Feld zeigt dann „gespeichert“. Leer lassen = gespeichertes Passwort weiter verwenden.
- Liste **Übertragungen** für alle Server gemeinsam (mit Kennzeichnung TFTP/FTP/HTTP/SFTP/SCP), inkl. fehlgeschlagener Anmeldungen. Die angezeigte Adresse und Beispielbefehle lassen sich per Klick kopieren.
- Beim ersten Start fragt die macOS-Firewall ggf., ob eingehende Verbindungen erlaubt werden. Ist ein Port belegt (z. B. durch die macOS-Dienste `tftpd` oder „Entfernte Anmeldung“ auf Port 22), erscheint eine Meldung – dann einen anderen Port wählen.

| Server | Standard-Port | Details |
|---|---|---|
| TFTP | 69 | RFC 1350 mit Optionen `blksize`, `tsize`, `timeout` (RFC 2347–2349), Modi `octet` und `netascii`, Dateien über 32 MB, Wiederholung bei Paketverlust. Ohne Anmeldung. Beispiel: `copy running-config tftp://<IP-des-Mac>/` |
| FTP | 21 | Benutzer/Passwort und/oder anonyme Anmeldung (anonym nur Lesen). Passiv (PASV/EPSV) und aktiv (PORT/EPRT), `LIST`/`NLST`/`MLSD`, Fortsetzen (`REST`), Ordner anlegen/löschen, Umbenennen. Datenverbindungen nur von/zu der IP-Adresse des angemeldeten Clients. Hinweis: FTP überträgt Passwörter unverschlüsselt. |
| HTTP | 8080 | Verzeichnisliste im Browser (abschaltbar, dann wird `index.html` ausgeliefert), Download mit Fortsetzen (Range), optional Benutzer/Passwort (Basic-Auth; Benutzer leer = ohne Anmeldung). Hochladen per `PUT`/`POST` (`curl -T datei.bin http://<IP>:8080/`) oder per Drag & Drop in der Verzeichnisliste, Löschen per `DELETE`. |
| SFTP/SCP | 2222 | Verschlüsselt über SSH: SFTP und klassisches SCP (`scp -O`, wie es Switches und Router verwenden), auch rekursiv. Anmeldung mit Benutzer/Passwort und/oder öffentlichen Schlüsseln (Feld im `authorized_keys`-Format). Eigener Host-Schlüssel (ed25519), wird beim ersten Start erzeugt und bleibt erhalten; der Fingerabdruck wird angezeigt. Kein Shell-Zugang – andere Befehle werden abgewiesen. Beispiele: `sftp -P 2222 benutzer@<IP>`, `scp -O -P 2222 datei.bin benutzer@<IP>:/` |

## Dateiübertragung per SCP

In einem SSH-Pane auf **⇅** in der Pane-Leiste klicken (oder ⇧⌘F, oder Pane-Menü → „Dateien übertragen (SCP)…“). Links öffnet sich der Tab **Dateien (SCP)** mit dem Home-Verzeichnis des Servers.

- **Navigieren:** Doppelklick auf Ordner, ↰ = eine Ebene höher, ⌂ = Home, Pfad oben eintippen + Enter
- **Synchron mit der Shell (ab 1.5.23, Standard: an):** Wechselt man im Terminal mit `cd` das Verzeichnis, wechselt der Browser automatisch mit. Schalter **⇄** in der Werkzeugleiste (oder ⋯ → „Mit dem Verzeichnis der Shell synchron halten“, oder Einstellungen). Erkannt wird das Verzeichnis über die Pfad-Meldung OSC 7, sonst über die Prompt-Zeile (`user@host:~/pfad$`, `root@host:/etc#`) oder den Fenstertitel. Zeigt der Prompt keinen Pfad, hilft ⋯ → „Pfad-Meldung in der Shell einrichten (bash/zsh)“ – das gilt für die laufende Shell; dauerhaft dieselbe Zeile in `~/.bashrc` bzw. `~/.zshrc` eintragen. Navigiert man selbst im Browser, bleibt diese Ansicht, bis in der Shell das nächste Mal das Verzeichnis gewechselt wird. Ist das Shell-Verzeichnis für den Datei-Browser nicht lesbar (z. B. nach `sudo -i` oder ssh auf einen weiteren Host), bleibt die bisherige Liste mit einem Hinweis stehen.
- **Direkt zur Datei springen (ab 1.5.23):** In die Liste klicken und tippen – z. B. `zus` markiert den ersten Eintrag, der mit „zus“ beginnt (sonst den ersten, der „zus“ enthält); nach einer Pause von einer Sekunde beginnt die Suche neu, dieselbe Taste mehrfach geht reihum. Außerdem: ↑/↓ markieren, Enter öffnet, ⌫ = eine Ebene höher, Esc hebt die Markierung auf.
- **Hochladen:** „↑ Hoch“ (Dateien und Ordner wählbar) oder Dateien/Ordner aus dem Finder in die Liste ziehen – auf einen Ordner gezogen landen sie dort. Dateien direkt aufs SSH-Terminal ziehen lädt ins aktuelle Browser-Verzeichnis hoch.
- **Herausziehen (ab 1.5.23):** Einträge (auch mehrere markierte, auch Ordner) aus der Liste in den Finder, auf den Schreibtisch oder in eine andere App ziehen. MacT-1000 lädt sie dafür erst in einen temporären Ordner; bei kleinen Dateien beginnt das Ziehen sofort, solange die Maustaste gedrückt bleibt. Wird sie vorher losgelassen (große Dateien), erscheint der Eintrag unter „Übertragungen“ mit „fertig – an das Ziel ziehen“ und lässt sich von dort ans Ziel ziehen. Erneutes Ziehen derselben, unveränderten Auswahl nutzt die bereits geladene Kopie.
- **Herunterladen:** markieren (⌘-Klick / ⇧-Klick für mehrere) und „↓ Runter“ → Download-Ordner (Standard `~/Downloads`, änderbar in den Einstellungen oder unter ⋯). Rechtsklick → „Herunterladen nach…“ fragt den Zielordner ab. Doppelklick auf eine Datei lädt eine temporäre Kopie und öffnet sie mit der Standard-App.
- **Weitere Aktionen (Rechtsklick):** Umbenennen, Löschen (rekursiv, mit Rückfrage), Pfad kopieren, Im Terminal hierhin wechseln (cd). Unter ⋯: versteckte Dateien anzeigen.
- **Übertragungen** erscheinen unten mit Fortschritt, Geschwindigkeit und Restzeit; laufende lassen sich mit × abbrechen. Vor dem Überschreiben vorhandener Dateien wird gefragt.

**Anmeldung:** Terminal und Datei-Browser teilen sich eine SSH-Verbindung (OpenSSH-`ControlMaster`, Sockets unter `~/.mact1000/cm/`). Ist die Terminal-Session angemeldet, gibt es keine zweite Passwort-/2FA-Abfrage. Ist keine Session offen, fragt MacT-1000 einmalig in einem eigenen Dialog nach Passwort bzw. Host-Schlüssel und hält diese Verbindung bis zu 10 Minuten ohne Nutzung offen; beim Beenden von MacT-1000 wird sie geschlossen. Schlüssel aus Schlüsselbund und ssh-agent werden wie gewohnt genutzt.

Pro Session (Session bearbeiten) gibt es dazu zwei Optionen:
- „Verbindung mit Datei-Browser (SCP) teilen“ (Standard: an) – ausschalten, falls die eigene `~/.ssh/config` bereits ControlMaster nutzt oder es Probleme gibt.
- „Klassisches SCP-Protokoll (scp -O)“ – für Geräte ohne SFTP-Subsystem (z. B. manche Switches, Router, Dropbear). Standard ist das moderne scp über SFTP.

**Unter Windows (ab 1.7.0 per SCP):** Windows-OpenSSH kennt kein ControlMaster, deshalb baut der Datei-Browser eine eigene SSH-Verbindung auf (Bibliothek ssh2) und fragt Passwort, Passphrase oder Host-Schlüssel bei Bedarf selbst ab; ein gespeichertes Passwort der Session (oder das Standard-Passwort des Ordners) wird automatisch verwendet. Schlüssel aus `%USERPROFILE%\.ssh` und der Dienst „OpenSSH Authentication Agent“ werden genutzt, sofern er läuft. Verzeichnisse werden wie auf dem Mac per Shell gelistet, übertragen wird mit dem klassischen SCP-Protokoll (`scp -t`/`scp -f` auf dem Server) – das funktioniert auch auf Servern und Geräten ohne SFTP-Subsystem. Bietet der Server keine Shell, aber SFTP, wird nur das Auflisten über SFTP erledigt. Bis 1.6.0 lief die Windows-Version komplett über SFTP; wer das braucht, startet MacT-1000 mit der Umgebungsvariablen `MACT_FX_BACKEND=sftp`.

Hinweis: Der Browser listet Verzeichnisse per `ls` in einer POSIX-Shell auf dem Server. Auf Geräten ohne Unix-Shell (z. B. Cisco IOS) funktioniert das Durchsuchen nicht; dort ist SCP meist ohnehin nur über die Geräte-CLI nutzbar.

## Pane-Freigabe (ab 1.8.0)

Ein laufendes Pane (lokale Shell, SSH, Telnet, Seriell, Befehl) lässt sich für andere Rechner freigeben, auf denen ebenfalls MacT-1000 läuft – zum gemeinsamen Arbeiten, für Support oder Schulungen. Der Zuschauer sieht das Pane live und kann mit Erlaubnis auch mittippen. Mac und Windows können sich gegenseitig verbinden.

Auch aus einem Aufruf von außen: `mact1000 --ssh admin@10.0.0.2 --share` (siehe [Direkt freigeben](#direkt-freigeben---share-ab-181)).

**Freigeben:** Pane-Menü (`⋯` oben rechts im Pane) → **„Session freigeben…“**. Im Dialog:

- **Name** – sieht der Zuschauer in seiner Kopfzeile.
- **Passwort** – wird zufällig erzeugt (↻ für ein neues, mindestens 4 Zeichen), beim Freigeben in die Zwischenablage kopiert. Auf einem anderen Weg weitergeben (z. B. Telefon).
- **Zugriff** – „Nur lesen“, „Lesen, Schreiben nach meiner Bestätigung“ oder „Lesen und Schreiben ohne Rückfrage“.
- **Gültig** – bis zum Beenden oder 1/4/8/24 Stunden; danach werden alle Zuschauer getrennt.
- Darunter stehen die Adressen dieses Rechners, der Port und der **Fingerprint**.

Beim ersten Mal muss das Häkchen **„Freigaben von Panes auf diesem Rechner erlauben“** gesetzt werden (auch in den Einstellungen → „Freigaben“). Standardmäßig ist die Funktion aus, und es lauscht kein Port.

Ein freigegebenes Pane hat einen türkisfarbenen Rahmen und in der Kopfzeile die Anzeige **„Freigegeben · n“** (n = Zuschauer, „· schreibt“, wenn jemand Schreibrecht hat). Ein Klick darauf öffnet die Verwaltung: Zuschauer mit Adresse und Uhrzeit, **Schreiben erlauben / Schreibrecht entziehen**, **Trennen**, Zugriff ändern, Passwort anzeigen oder kopieren, **Freigabe beenden**. Wird das Pane geschlossen, endet die Freigabe; nach „Neu verbinden“ läuft sie mit der neuen Verbindung weiter.

**Verbinden (Zuschauer):** Quick Connect `share 192.168.1.20` (anderer Port: `share 192.168.1.20:7100`, auch `freigabe host`) oder eine gespeicherte Session vom Typ **„Freigabe“** (Rechner, Port, Passwort, optional Name der Freigabe und eigener Anzeigename). Beim ersten Verbinden fragt MacT-1000, ob der angezeigte Fingerprint stimmt – mit dem Fingerprint im Freigabe-Dialog des anderen Rechners vergleichen. Danach wird er gemerkt; ändert er sich später, wird die Verbindung abgelehnt (Eintrag unter Einstellungen → „Freigaben“ → „Bekannte Freigaben“ entfernen, wenn MacT-1000 dort neu installiert wurde). Laufen auf dem Rechner mehrere Freigaben mit demselben Passwort, erscheint eine Auswahl.

Der Zuschauer bekommt zuerst den aktuellen Bildschirminhalt samt Verlauf (bis 2000 Zeilen), dann alles live. Die **Größe bestimmt das freigegebene Pane**; ist das eigene Pane kleiner, erscheinen Rollbalken. Eingaben ohne Schreibrecht werden nicht gesendet, ein Hinweis bietet **„Schreibrecht anfordern“** an (auch Klick auf „Nur lesen“ in der Kopfzeile oder Pane-Menü). Beim Freigebenden erscheint dann im Pane „… möchte in dieser Session schreiben“ mit **Erlauben / Ablehnen** (ohne Antwort nach 60 Sekunden abgelehnt). Bei „Lesen und Schreiben ohne Rückfrage“ gilt das Schreibrecht sofort. Mit Schreibrecht wird die Anzeige orange; ein Klick darauf gibt es wieder ab.

**Sicherheit:**

- Die Verbindung läuft über SSH (Bibliothek ssh2) – verschlüsselt, mit eigenem Schlüssel pro Rechner (ed25519) und Fingerprint-Prüfung. Zuschauer bekommen keine Shell und keinen Dateizugriff, nur das eine freigegebene Pane.
- Anmeldung nur mit dem Passwort der Freigabe. Nach 5 falschen Versuchen innerhalb von 10 Minuten wird die Adresse 10 Minuten gesperrt; höchstens 20 Zuschauer pro Freigabe.
- Schreibrecht nur, wenn der Freigebende es erlaubt. Bei einer **lokalen Shell** warnt MacT-1000 ausdrücklich: Ein Zuschauer mit Schreibrecht arbeitet dann mit deinen Rechten auf deinem Rechner. Bei SSH-/Telnet-Sessions tippt er mit deiner Anmeldung auf dem Zielgerät.
- Beim Beenden von MacT-1000 werden alle Freigaben beendet; die Rückfrage beim Beenden nennt laufende Freigaben mit Zuschauern.
- Gedacht für das eigene Netz oder VPN. Über das Internet nicht direkt öffnen, sondern z. B. per VPN oder SSH-Tunnel (`ssh -L 7022:localhost:7022 benutzer@rechner`, dann `share localhost`).

**Einstellungen → „Freigaben“:** Freigaben erlauben, **Port** (Standard 7022), **Netzwerkadresse** (leer = alle; z. B. nur die VPN-Adresse), eigener Name beim Zuschauen, Fingerprint dieses Rechners, bekannte Freigaben anderer Rechner. Beim ersten Freigeben fragt die Firewall (macOS bzw. Windows) eventuell, ob eingehende Verbindungen erlaubt werden; ist der Rechner nicht erreichbar, Port 7022/TCP in der Firewall freigeben.

## Kopieren beim Markieren

Mit der Maus markierter Text in einem Session-Fenster landet sofort in der Zwischenablage, kurz bestätigt mit „In die Zwischenablage kopiert“ (Einstellung „Markierten Text automatisch in die Zwischenablage kopieren“, Standard: an; mit 1.5.23 einmalig eingeschaltet, falls sie bisher aus war). Doppelklick markiert ein Wort, Dreifachklick eine Zeile. In Programmen mit Mausbedienung (z. B. htop, mc, vim mit Maus) beim Markieren ⌥ gedrückt halten.

## Makros

Makros führen Eingaben abhängig von der Terminal-Ausgabe aus – z.B. Login auf einem Switch, Befehlsfolgen oder wiederkehrende Abfragen. Aufruf über die Schaltfläche **Makros** in der Werkzeugleiste, das Menü **Makros** oder das ⋯-Menü eines Panes.

**Schritte** (werden der Reihe nach ausgeführt):

| Schritt | Wirkung |
|---|---|
| Warten auf Ausgabe | Hält an, bis der Text in der Ausgabe erscheint (optional regulärer Ausdruck). Zeitlimit in Sekunden (0 = unbegrenzt), danach abbrechen oder weitermachen |
| Senden | Schickt Text an die Session, optional mit Enter. Escape-Zeichen: `\r` `\n` `\t` `\e` (Esc) `\xHH` (z.B. `\x03` = Ctrl+C) |
| Pause | Wartet eine feste Zeit in Millisekunden |

**Vor dem Start verbinden:** Im Makro-Editor unter „Vor dem Start verbinden“ eine gespeicherte Session wählen (lokale Shell, SSH, Telnet, seriell – nicht RDP) und festlegen, wo sie geöffnet wird: in neuem Tab, geteilt nebeneinander oder untereinander. Beim Start des Makros (Menü „Makros“, ⇧⌘M, Verwaltung) wird zuerst die Verbindung aufgebaut und das Makro dann darin ausgeführt – unabhängig vom aktiven Pane und von Multi-Input. Bestätigung und Variablen werden vorher abgefragt; bei „Abbrechen“ wird keine Verbindung geöffnet. Das Makro liest ab Verbindungsbeginn mit, ein typischer Ablauf ist z.B. `Warten auf „password:“` → `Senden {{Passwort}}` → `Warten auf „#“` → Befehle. Ein in der Session hinterlegtes Autostart-Makro wird dabei nicht zusätzlich gestartet. Beim Autostart und bei Auto-Antworten läuft ein solches Makro im auslösenden Pane, ohne neue Verbindung. Wird die Session gelöscht, meldet das Makro dies beim Start.

**Bestätigung vor dem Start:** Im Makro-Editor „Vor dem Start bestätigen“ anhaken, optional mit eigenem Hinweistext (z.B. „Achtung: lädt die Konfiguration neu“). Vor jedem Start erscheint dann ein Dialog mit Ziel-Pane(s) und einer Vorschau der Schritte; erst nach „Ausführen“ wird etwas gesendet. Gilt auch für den Autostart nach dem Verbinden und für Makros, die von einer Auto-Antwort gestartet werden – dort wird die Ausgabe schon mitgelesen, gesendet wird aber erst nach der Bestätigung. Bei mehreren Multi-Input-Panes wird einmal für alle gefragt.

**Variablen:** `{{Name}}` im Sende-Text wird beim Start abgefragt (bei Namen mit „Pass“, „Kennwort“, „PIN“, „Token“ als verdecktes Feld). Die Werte werden nicht gespeichert.

**Schleifen:** Im Makro-Editor „+ Schleife“ anlegen (oder einen Schritt auf „Schleife“ / „Schleifenende“ umstellen). Alle Schritte zwischen „Schleife“ und „Schleifenende“ laufen einmal je Wert; mit ↑/↓ werden Schritte in die Schleife hinein- oder herausgeschoben, der Editor rückt den Rumpf ein. Schleifen lassen sich verschachteln.

- **Zahlen:** durch Komma, Semikolon oder Leerzeichen getrennt, Bereiche mit Bindestrich – z.B. `1,2,3 7-10` → 1, 2, 3, 7, 8, 9, 10. Absteigend `10-1`, mit Schrittweite `0-100/10`, mit führenden Nullen `01-12` → 01 … 12.
- **Texte:** durch Komma getrennt, Leerzeichen am Rand werden entfernt – z.B. `Gi1/0/1, Gi1/0/5, uplink`. Ein Komma im Wert als `\,`.
- **Verwendung:** Im Rumpf steht der aktuelle Wert als `{{Name}}` zur Verfügung, `{{Name#}}` ist die Nummer des Durchlaufs (1, 2, 3 …). Das gilt für „Senden“ und „Warten auf Ausgabe“. Beispiel: Schleife `{{Port}}` über `1-24` → `Senden interface Gi1/0/{{Port}}` → `Warten auf „(config-if)#“` → `Senden shutdown` → Schleifenende.
- **Werte beim Start abfragen:** Die Werteliste darf selbst eine Variable enthalten, z.B. `{{Ports}}` – sie wird beim Start wie jede andere Variable abgefragt (Eingabe z.B. `3,5,9-12`).
- Der Editor zeigt neben jeder Schleife die Anzahl der Durchläufe (Tooltip: die Werte) und markiert Fehler; ungültige Angaben werden beim Speichern abgewiesen, zur Laufzeit stoppt das Makro mit Meldung. Die Pane-Kopfzeile zeigt den aktuellen Wert, z.B. `▶ Ports 3/5 · Port=7 (5/12)`. Maximal 10.000 Werte je Schleife.

**Aufzeichnen:** In einem verbundenen Pane ⇧⌘R drücken (oder Makros → Aufzeichnung starten), ganz normal arbeiten, erneut ⇧⌘R. MacT-1000 erzeugt daraus „Warten auf <zuletzt angezeigter Prompt>“ + „Senden <deine Eingabe>“. Eingaben nach einer Passwort-Abfrage (`Password:`, `Kennwort:` …) werden **nicht** aufgezeichnet, sondern durch `{{Passwort}}` ersetzt. Das Ergebnis öffnet sich im Editor zum Prüfen und Speichern. Während der Aufnahme zeigt das Pane „● Aufnahme“.

**Ausführen:** Makros → ▶ Name (oder ⇧⌘M). Ist Multi-Input mit mehreren Panes aktiv, läuft das Makro in allen markierten Panes gleichzeitig. Ein laufendes Makro wird in der Pane-Kopfzeile mit Fortschritt angezeigt – Klick darauf oder ⌘. stoppt es.

**Autostart:** Im Session-Dialog unter „Makro nach dem Verbinden“ ein Makro wählen – es startet bei jedem (Neu-)Verbinden dieser Session automatisch, z.B. für Login und Grundkonfiguration.

**Auto-Antworten:** Makros → Auto-Antworten… Regeln „wenn die Ausgabe X enthält → sende Y“ (oder starte ein Makro), dauerhaft aktiv in allen bzw. ausgewählten Sessions (Filter auf Teile von Name/Host/Ordner, mehrere mit Komma). Beispiele: `--More--` → Leerzeichen ohne Enter, `(yes/no)?` → `yes`. Eine Regel, die mehr als 25-mal in 10 Sekunden auslöst, wird für das Pane pausiert (Schutz vor Endlosschleifen).

## Tabs und Panes per Drag & Drop

- **Tab in ein geteiltes Fenster ziehen:** Tab anfassen, kurz über den Ziel-Tab halten (dieser wird nach ca. ½ s aktiv), dann auf den linken/rechten/oberen/unteren Rand eines Panes ziehen. Die grüne Markierung zeigt, wo eingefügt wird. Alle Panes des gezogenen Tabs wandern samt laufender Sessions mit, der Quell-Tab verschwindet.
- **Ohne Maus:** Rechtsklick auf einen Tab → „Neben „…“ einfügen (geteilt)“.
- **Einzelnes Pane verschieben:** Pane an seiner Kopfzeile ziehen – auf den Rand eines anderen Panes (auch in einem anderen Tab) oder auf eine freie Stelle der Tab-Leiste (= eigener neuer Tab).
- **Tab duplizieren:** ⌥⇧⌘D, Menü „Ansicht → Tab duplizieren“ oder Rechtsklick auf den Tab. Es entsteht direkt rechts daneben ein neuer Tab mit derselben Aufteilung; jede Session darin wird neu verbunden (lokale Shells starten im aktuellen Verzeichnis). Ein hinterlegtes Autostart-Makro einer Session läuft dabei erneut. (⌘D bleibt „Vertikal teilen“.)
- **Tabs umsortieren:** Tab innerhalb der Tab-Leiste vor oder hinter einen anderen Tab ziehen.

Sessions werden dabei nicht neu aufgebaut – SSH-, Telnet- und serielle Verbindungen laufen unterbrechungsfrei weiter.

## Passwörter

- **Hinterlegen:** Im Session-Dialog gibt es für SSH und Telnet ein Feld „Passwort“. Das Passwort wird verschlüsselt gespeichert (Electron safeStorage, Schlüssel im macOS-Schlüsselbund) und landet nicht im Klartext im gespeicherten Fenster-Layout.
- **SSH:** Beim Passwort-Prompt des Zielhosts (`user@host's password:` bzw. `Password:`) gibt MacT-1000 das gespeicherte Passwort einmal automatisch ein. Wird es abgelehnt, erscheint ein Hinweis und du gibst es von Hand ein. Prompts von Jump-Hosts und Schlüssel-Passphrasen werden nicht beantwortet (Passphrasen: Schlüsselbund-Option).
- **Telnet:** Benutzer + Passwort werden bei `login:` / `Password:` eingegeben; das Häkchen „Auto-Login“ wird beim Eintippen eines Passworts automatisch gesetzt.
- **Neu verbinden (ab 1.8.5):** Beim Neu verbinden (⌘R bzw. Strg+Umschalt+R, Kontextmenü, „Alle Sessions neu verbinden“) und beim Duplizieren nimmt MacT-1000 immer das aktuell gespeicherte Passwort der Session – auch wenn es seit dem ersten Verbinden geändert oder erst nachträglich gespeichert wurde. Die Passwort-Abfrage wird auch erkannt, wenn das Terminal Steuerzeichen mitschickt (z. B. die Windows-Konsole); Telnet erkennt zusätzlich `Passwort:`, `Kennwort:` und `Benutzername:`.
- **Nach manueller Anmeldung speichern:** Meldest du dich per SSH oder Telnet von Hand mit Passwort an, blendet MacT-1000 nach erfolgreichem Login oben im Pane ein: „Passwort … speichern?“ mit *Speichern* / *Nicht jetzt* / *Nie für diese Session*. Bei einer Quick-Connect-Verbindung wird dabei die Session mit Passwort angelegt. Wurde das Passwort direkt erneut abgefragt (falsch), wird nichts angeboten; `sudo`-Abfragen werden ignoriert. Abschaltbar unter Einstellungen.
- **Standard-Passwort pro Ordner (ab 1.7.0):** Rechtsklick auf einen Ordner → **„Standard-Passwort festlegen…“**. Es gilt für alle SSH- und Telnet-Sessions in diesem Ordner und in allen Unterordnern, die kein eigenes Passwort haben – praktisch, wenn z. B. alle Switche eines Standorts dasselbe Passwort nutzen. Hat ein Unterordner ein eigenes Standard-Passwort, gilt dieses (der nächstgelegene Ordner gewinnt). Ein eigenes Passwort der Session hat immer Vorrang. Ordner mit Standard-Passwort tragen in der Liste die Markierung **PW**; der Session-Dialog zeigt im leeren Passwortfeld „leer = Standard-Passwort des Ordners …“. Es wird wie die Session-Passwörter verschlüsselt gespeichert (macOS-Schlüsselbund bzw. Windows DPAPI), wandert beim Umbenennen und Verschieben des Ordners mit und wird beim Löschen des Ordners entfernt. Der Datei-Browser nutzt es ebenfalls. Es bleibt auf dem jeweiligen Rechner und wird nicht über den Netzordner verteilt; im Konfigurations-Export mit Passwörtern ist es enthalten. Ändern oder entfernen: erneut Rechtsklick → „Standard-Passwort ändern…“.
- **Schlüsselbund-Zugriff:** Da die App nicht mit einer Apple-Entwickler-ID signiert ist, fragt macOS nach einem Update evtl. „MacT-1000 möchte auf den Schlüssel „MacT-1000 Safe Storage“ zugreifen“ – mit dem Mac-Passwort und **Immer erlauben** bestätigen. Wird der Zugriff verweigert, bleiben die Passwörter verschlüsselt erhalten (früher gingen sie dabei verloren); die Session zeigt dann „gesperrt“ und das Passwort kann neu eingegeben werden.

## Tastenkürzel

Unter Windows bleibt Strg+Buchstabe für die Shell frei (Strg+C, Strg+D, Strg+R …); Programmfunktionen liegen auf Strg+Umschalt bzw. Alt+Umschalt. Strg+C kopiert, wenn Text markiert ist, Strg+V fügt ein. Tooltips, Menüs und Kontextmenüs (Rechtsklick bzw. `⋯` im Pane, Tab, Session-Liste, Makros; ab 1.8.3) zeigen jeweils das Kürzel des laufenden Systems rechts neben dem Eintrag.

| Funktion | Mac | Windows |
|---|---|---|
| Neuer Tab mit lokaler Shell | ⌘T | Strg+Umschalt+T |
| Neue Session | ⌘N | Strg+Umschalt+S |
| Quick Connect | ⌘K | Strg+Umschalt+K |
| Vertikal teilen (nebeneinander) | ⌘D | Strg+Umschalt+E |
| Horizontal teilen (untereinander) | ⇧⌘D | Strg+Umschalt+O |
| Session in neuem Pane duplizieren | ⌥⌘D | Alt+Umschalt+D |
| Getrennte Verbindung neu verbinden – ist sie noch aktiv, wird sie in einem neuen Tab direkt daneben dupliziert | ⌘R | Strg+Umschalt+R |
| Tab duplizieren (gleiche Aufteilung, alle Sessions neu verbunden) | ⌥⇧⌘D | Alt+Umschalt+T |
| Nächstes / vorheriges Pane im aktuellen Tab | ⌘] / ⌘[ | Strg+Umschalt+N / Strg+Umschalt+P |
| Nächstes / vorheriges Pane über alle Tabs hinweg (nach dem letzten Pane eines Tabs geht es im nächsten Tab weiter) | ⌘→ / ⌘← | Alt+Umschalt+→ / Alt+Umschalt+← |
| Nächster / vorheriger Tab | ⇧⌘] / ⇧⌘[ | Strg+Bild↓ / Strg+Bild↑ (auch Strg+Tab / Strg+Umschalt+Tab) |
| Tab 1–9 direkt | ⌘1–9 | Alt+1–9 |
| Pane maximieren | ⇧⌘↩ | Strg+Umschalt+X |
| Panes gleichmäßig verteilen | ⌥⌘= | Strg+Umschalt+G |
| Multi-Input ein/aus | ⇧⌘I | Strg+Umschalt+I |
| Alle Panes des Tabs für Multi-Input wählen | ⇧⌘A | Alt+Umschalt+A |
| Multi-Paste | ⇧⌘V | Strg+Umschalt+M |
| Makro ausführen | ⇧⌘M | Alt+Umschalt+M |
| Makro-Aufzeichnung starten / stoppen | ⇧⌘R | Alt+Umschalt+R |
| Laufende Makros stoppen | ⌘. | Strg+. |
| Kopieren / Einfügen | ⌘C / ⌘V | Strg+Umschalt+C / Strg+Umschalt+V |
| Alles markieren | ⌘A | Strg+Umschalt+A |
| Suchen | ⌘F | Strg+Umschalt+F |
| Terminal leeren | ⌘L | Strg+Umschalt+L |
| Pane / Tab schließen | ⌘W / ⇧⌘W | Strg+Umschalt+W / Strg+Umschalt+Q |
| Seitenleiste ein/aus | ⌘B | Strg+Umschalt+B |
| Datei-Browser (SCP) für das aktive SSH-Pane | ⇧⌘F | Strg+Umschalt+D |
| Server anzeigen (TFTP, FTP, HTTP, SFTP/SCP) | ⌥⌘T | Alt+Umschalt+S |
| Einstellungen | ⌘, | Strg+, |
| Gesamte Konfiguration exportieren | ⇧⌘E | – (Menü Datei) |
| Schriftgröße größer / kleiner / Standard | ⌘+ / ⌘- / ⌘0 | Strg++ / Strg+- / Strg+0 |
| Dialog bestätigen | ⌘↩ | Strg+Enter |
| Neue Session aus einer laufenden Session-Suche erstellen | Enter im Suchfeld | Enter im Suchfeld |
| Wort zurück / vor | ⌥← / ⌥→ | Strg+← / Strg+→ (je nach Shell) |
| Zeilenanfang / -ende | fn← / fn→ oder Ctrl+A / Ctrl+E | Pos1 / Ende oder Strg+A / Strg+E |
| Vollbild / Entwicklerwerkzeuge | ⌃⌘F / ⌥⌘I | F11 / F12 |

Beendete Sessions lassen sich mit ⌘R bzw. Strg+Umschalt+R neu verbinden (Enter löst bewusst nichts aus, damit kein versehentlicher Neuaufbau passiert). Ist die Verbindung im aktiven Pane noch aktiv, öffnet dasselbe Kürzel die Verbindung zusätzlich in einem neuen Tab direkt rechts daneben (lokale Shells im aktuellen Verzeichnis); als geteiltes Pane geht das mit ⌥⌘D bzw. Alt+Umschalt+D.

### Ordner in der Session-Liste

Unter den Suchergebnissen steht **Neue Session erstellen…**, auch wenn nichts gefunden wurde. Ein Klick oder **Enter** im Suchfeld öffnet den Dialog. Ein Hostname oder eine IP-Adresse wird als Host vorgeschlagen, anderer Suchtext als Name. Vorhandene Sessions lassen sich weiterhin per Doppelklick öffnen.

- **Anlegen:** Rechtsklick in die Session-Liste (freie Fläche, auf einen Ordner oder eine Session) → „Neuer Ordner…“. Neue Ordner sind zunächst leer und bleiben auch leer bestehen.
- **Verschieben:** Session mit der Maus auf einen Ordner ziehen (der Ordner wird blau markiert). Auf eine Session in einem Ordner ziehen geht auch. Auf „Sessions (ohne Ordner)“ oder auf die freie Fläche ziehen nimmt die Session aus dem Ordner. Alternativ Rechtsklick auf die Session → „In Ordner verschieben…“.
- **Unterordner:** Rechtsklick auf einen Ordner → „Neuer Unterordner…“ (im Dialog lässt sich der Oberordner auch frei wählen). Beliebig tief verschachtelbar, z. B. `Rechenzentrum › Core › Switche`. Im Session-Dialog kann der Ordner auch als Pfad eingetippt werden: `Rechenzentrum/Core/Switche` – fehlende Ordner werden automatisch angelegt. Ordnernamen dürfen deshalb kein „/“ enthalten.
- **Ordner verschieben:** einen Ordner auf einen anderen ziehen macht ihn (samt Inhalt und Unterordnern) zum Unterordner; auf „Sessions (ohne Ordner)“ ziehen oder Rechtsklick → „Auf oberste Ebene verschieben“ holt ihn nach oben. Jeder Ordner lässt sich einzeln einklappen; die Zahl am Ordner zählt alle Sessions inklusive Unterordnern.
- **Ordner-Rechtsklick:** Alle als Kacheln öffnen (inklusive Unterordner), neue Session direkt in diesem Ordner, Sessions aus CSV hierher importieren, neuer Unterordner, umbenennen, Standard-Passwort festlegen. **Ordner löschen** verschiebt den Inhalt eine Ebene nach oben. **Ordner samt Inhalt löschen…** entfernt nach Bestätigung den Ordner, alle Unterordner und alle darin gespeicherten Sessions samt Zugangsdaten aus dem Adressbuch. Offene Verbindungen bleiben geöffnet. Bei aktivierter Netzwerk-Konfiguration wird die Änderung wie andere Änderungen am Adressbuch synchronisiert; vorhandene Backups bleiben unverändert.
- Sessions aus der Liste auf ein Pane zu ziehen öffnet sie wie bisher.
- Leere Ordner werden in den Einstellungen gespeichert und beim Konfigurations-Export mitgenommen.

Rückfrage beim Schließen: Solange SSH-, Telnet- oder serielle Verbindungen aktiv sind, fragt MacT-1000 vor dem Schließen eines Panes, eines Tabs, des Fensters und vor dem Beenden (⌘Q bzw. Datei → Beenden) nach, ob wirklich beendet werden soll. Lokale Shells und RDP (externes Programm) lösen keine Rückfrage aus. Die Rückfrage lässt sich mit **Enter** bestätigen (Verbindung wird getrennt und geschlossen) oder mit Esc abbrechen – auch beim Schließen des Fensters und beim Beenden. Abschaltbar unter Einstellungen → „Vor dem Schließen … bei aktiven Verbindungen nachfragen“.

## Selbst bauen

Voraussetzung: Node.js 20+ (macOS: `brew install node`). Xcode bzw. Visual Studio sind nicht nötig – node-pty und serialport bringen fertige Binaries für macOS und Windows mit.

```bash
npm install
npm start                 # Entwicklungsmodus
npm run dist:mac          # ZIPs für Apple Silicon und Intel -> dist/
npm run dist:win          # Windows: Installer und portable EXE -> dist/
npm run dist:setup        # nur Windows-Installer
npm run dist:portable     # nur portable EXE
```

Die Windows-Pakete lassen sich auch unter macOS oder Linux bauen. Für eine eigene Signatur mit Apple-Developer-ID in `package.json` unter `build.mac.identity` den Zertifikatsnamen eintragen (statt `null`).

## Aufbau

```
src/main.js       Electron-Hauptprozess, Menü, IPC
src/sessions.js   Session-Manager, PTY für lokale Shell / ssh / Befehle
src/scp.js        SCP-Dateiübertragung, Verzeichnisliste, gemeinsame SSH-Verbindung
src/ssh-args.js   Argument-Hilfsfunktionen
src/telnet.js     Telnet-Client (RFC 854, NAWS, TTYPE)
src/serial.js     Serielle Konsole (serialport, /dev/cu.* bzw. COM-Ports)
src/config-io.js  Export/Import der Konfiguration (inkl. Passwort-Verschlüsselung)
src/rdp.js        RDP-Start über Windows App oder FreeRDP (macOS) bzw. mstsc.exe (Windows)
src/store.js      Sessions/Einstellungen (verschlüsselte Passwörter), lokal oder Netzlaufwerk
src/shared.js     Gemeinsame Konfiguration: Sperre, Überwachung, Offline-Abgleich
src/merge3.js     3-Wege-Zusammenführung gleichzeitiger Änderungen
src/tftp.js       TFTP-Server (RFC 1350, blksize/tsize/timeout)
src/srv-common.js Gemeinsame Teile der Dateiserver: Verzeichnisschutz, Übertragungsprotokoll
src/ftp-server.js FTP-Server (aktiv/passiv, MLSD, REST)
src/http-server.js HTTP-Server (Verzeichnisliste, Range, PUT/POST/DELETE, Basic-Auth)
src/ssh-server.js SFTP-/SCP-Server (Bibliothek ssh2)
src/version.js    Versionsvergleich für die Konfigurationsversion
src/update.js     Abfrage des neuesten Releases auf GitHub (Update-Hinweis)
src/updater.js    Automatisches Update: wählt die Variante für macOS bzw. Windows
src/updater-mac.js Update unter macOS: Download, SHA-256-Prüfung, Entpacken, Austausch nach dem Beenden
src/updater-win.js Update unter Windows: nur Hinweis, Download von Installer bzw. portable EXE im Browser
src/sftp.js       SSH-Anmeldung des Windows-Datei-Browsers (ssh2) und SFTP-Rückfalloption
src/scp-win.js    Datei-Browser unter Windows: Auflisten per Shell, Übertragung per SCP-Protokoll
src/compat.js     Kennungen früherer Versionen (Datenübernahme, frühere Links und Formate)
src/launch.js     Aufrufe von außen: Kommandozeile und mact1000://-Links auswerten
src/share.js      Pane-Freigabe: Freigabe-Dienst (SSH-Server, Passwort, Sperre, Schreibrecht) und Zuschauer-Verbindung
build/bin/mact1000 Kommandozeilen-Werkzeug (in der Mac-App unter Contents/Resources/bin)
build/installer.nsh Ergänzungen für den Windows-Installer (Links, Ablösung von WinT-1000)
beispiele/        Vorlagen: Automator-Ablauf, .command-Datei, AppleScript (macOS), Batch und PowerShell (Windows), CSV-Vorlage für den Session-Import
renderer/csv-import.js CSV-Import von Sessions mit Ordnern und Unterordnern
renderer/share.js Pane-Freigabe: Dialoge, Anzeige in der Kopfzeile, Zuschauerverwaltung, Schreibrecht-Anfragen
renderer/i18n.js  Sprachumschaltung Deutsch/Englisch; renderer/i18n-en.js enthält die englischen Texte
renderer/         Oberfläche: Tabs, Split-Layout, Dialoge, Datei-Browser, Server-Tab, Makros und Makro-Schleifen, Aufrufe von außen (xterm.js)
test/             Unit-, Telnet-, SCP-, Server- und End-to-End-Tests
```

Daten liegen unter `~/Library/Application Support/MacT-1000/` (macOS) bzw. `%APPDATA%\MacT-1000` (Windows).

### Umstieg von WinT-1000 (Windows, bis 1.5.23)

- **Daten:** Beim ersten Start übernimmt MacT-1000 einmalig Sessions, Ordner, Makros, Einstellungen, Server-Einstellungen und gespeicherte Passwörter aus `%APPDATA%\WinT-1000`. Gibt es in `%APPDATA%\MacT-1000` schon Daten, werden diese vorher nach `%APPDATA%\MacT-1000\Sicherung-vor-1.6.0` gesichert. Der alte Ordner bleibt unverändert.
- **Installer:** Die Setup-Variante entfernt eine installierte WinT-1000 (Programmdateien und Verknüpfungen, nicht die Daten) und richtet `mact1000://` und `wint1000://` ein.
- **Links und Skripte:** `wint1000://`-Links funktionieren weiter. In Batch-/PowerShell-Skripten den Pfad der EXE anpassen (`…\Programs\MacT-1000\MacT-1000.exe`).
- **Gemeinsame Netzwerk-Konfiguration:** Ein Netzwerkordner, den WinT-1000 angelegt hat (`WinT-1000-config.json`), wird weiter gelesen und mitgepflegt; Macs und PCs teilen damit denselben Stand.
- **Exporte** aus WinT-1000 lassen sich importieren.

### Umstieg von MacTerm (bis 1.4.0)

Beim ersten Start übernimmt MacT-1000 automatisch Sessions, Einstellungen, Ordner und Layout aus `~/Library/Application Support/MacTerm/`. Ausnahme: **in der App gespeicherte Passwörter** – sie sind mit einem Schlüssel verschlüsselt, der an den App-Namen gebunden ist, und müssen einmalig neu eingegeben werden. Alternativ in MacTerm „Konfiguration exportieren“ mit Passwörtern wählen und in MacT-1000 importieren. SSH-Schlüssel-Passphrasen im macOS-Schlüsselbund sind nicht betroffen. Die alte `MacTerm.app` kann danach gelöscht werden.

## Releases auf GitHub

Damit Update-Prüfung und automatisches Update funktionieren, im Repository [denkteich/MacT-1000](https://github.com/denkteich/MacT-1000) je Version ein Release mit dem Tag `v<Version>` (z. B. `v1.8.7`) anlegen und diese Dateien anhängen (Dateinamen genau so):

| Datei | Wofür |
|---|---|
| `MacT-1000-<Version>-arm64-mac.zip` | Apple Silicon – wird vom automatischen Update geladen |
| `MacT-1000-<Version>-x64-mac.zip` | Intel-Macs – wird vom automatischen Update geladen |
| `MacT-1000-<Version>-setup.exe` | Windows-Installer – „Herunterladen“ der installierten Windows-Version lädt ihn im Browser |
| `MacT-1000-<Version>-portable.exe` | Windows portable – „Herunterladen“ der portable EXE lädt sie im Browser |

## Hinweise

- Getestet wurde nur in einer Linux-Testumgebung (Oberfläche im macOS- und im Windows-Modus, Abläufe, Update-Logik mit Testserver). Ein Test auf einem echten Mac und einem echten Windows-Rechner steht aus – auch für Installer, Datenübernahme, das automatische Update unter macOS und den Download im Browser unter Windows.
- Die Firewall (macOS bzw. Windows) fragt beim ersten Start eines Servers (TFTP/FTP/HTTP/SFTP) ggf., ob eingehende Verbindungen erlaubt werden.
- Pane-Freigabe: getestet wurde nur innerhalb einer Testumgebung (Freigabe und Zuschauer auf demselben Rechner über 127.0.0.1), nicht zwischen zwei echten Rechnern im Netz. Die Firewall fragt beim ersten Freigeben ggf. ebenfalls.

## Lizenz

MacT-1000 steht unter der [MIT-Lizenz](LICENSE) – Copyright (c) 2026 Harald Thomas.

Kurz gesagt: Nutzen, kopieren, ändern und weitergeben (auch kommerziell) ist erlaubt, solange der Copyright-Hinweis und der Lizenztext erhalten bleiben. Die Software wird ohne Gewährleistung bereitgestellt.

Verwendete Bibliotheken und ihre Lizenzen (alle MIT): Electron, xterm.js, node-pty, serialport, ssh2. Electron bringt zusätzlich die Lizenzen von Chromium mit (`LICENSES.chromium.html` im App-Paket).
