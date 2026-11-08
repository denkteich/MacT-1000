# MacT-1000

> Der Name spielt auf den T-1000 aus „Terminator 2“ an – den Terminator aus Flüssigmetall, der sich teilen und wieder zusammenfließen kann. Genau wie die Fenster von MacT-1000.

Terminal-Client für macOS – lokale Shell, SSH (mit SCP-Dateiübertragung), Telnet, serielle Konsole und RDP in einem Fenster, mit frei teilbaren Panes, Multi-Input und Multi-Paste.

## Installation (fertige App)

1. Passende ZIP-Datei entpacken:
   - `MacT-1000-1.5.16-arm64-mac.zip` – Apple Silicon (M1/M2/M3/M4/M5/M6)
   - `MacT-1000-1.5.16-x64-mac.zip` – Intel-Macs
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
| SSH | Nutzt das System-`ssh` → `~/.ssh/config`, Schlüssel, ssh-agent, Jump-Hosts (-J), Port-Weiterleitungen (L/R/D), Agent-/X11-Forwarding, Keepalive, Option für alte Algorithmen (ältere Switches), gespeichertes Passwort wird beim Login-Prompt automatisch eingegeben (siehe „Passwörter“) |
| SCP-Dateiübertragung | Seitenleisten-Tab „Dateien (SCP)“ folgt dem aktiven SSH-Pane: Verzeichnisse durchsuchen, Hoch-/Herunterladen von Dateien und Ordnern mit Fortschritt, Drag & Drop aus dem Finder, Ordner anlegen, umbenennen, löschen, „Im Terminal hierhin wechseln (cd)“. Nutzt die Anmeldung der Terminal-Session mit (siehe unten) |
| TFTP-Server | Seitenleisten-Tab „TFTP“: bei Bedarf in einem wählbaren Verzeichnis starten, z. B. für Firmware-Updates und Konfigurations-Backups von Switches/Routern. Download und optional Upload, Port und Netzwerkadresse wählbar, Fortschritt pro Übertragung (siehe unten) |
| Update-Hinweis | Prüft beim Start und alle 6 Stunden das neueste Release auf GitHub und zeigt bei einer neuen Version einen Hinweis mit Link zur Release-Seite |
| Telnet | Eigene Implementierung mit Optionsverhandlung (ECHO, SGA, TTYPE, NAWS = Fenstergröße), Auto-Login, CR/LF-Modus, Raw-TCP für Konsolenserver, Break/Interrupt. Ist ein Passwort hinterlegt, ist Auto-Login automatisch aktiv |
| Seriell | Alle `/dev/cu.*`-Ports, Baudrate 300–921600, Datenbits, Parität, Stoppbits, RTS/CTS bzw. XON/XOFF, Break-Signal (z. B. Cisco ROMMON), DTR/RTS umschalten, lokales Echo |
| RDP | Startet „Windows App“ (Microsoft, App Store) über eine erzeugte .rdp-Datei oder FreeRDP (`brew install freerdp`, Passwortabfrage im Pane). Auflösung, Multi-Monitor, Zwischenablage, Laufwerke, RD-Gateway, Admin-Session |
| Split-Panes | Jedes Pane beliebig vertikal (nebeneinander) und horizontal (untereinander) teilbar, Trenner per Maus ziehen (Doppelklick = 50/50), Pane maximieren, gleichmäßig verteilen, Pane in neuen Tab verschieben. Tabs und Panes per Drag & Drop neu anordnen (siehe unten) |
| Multi-Input | Tastatureingaben gehen gleichzeitig an alle markierten Panes – über Tabs hinweg. Pro Pane über das ⇶-Symbol ein-/ausschließbar. Markierte Panes sind orange umrandet |
| Makros | Abläufe „warte auf Ausgabe → sende Eingabe“, manuell erstellen oder aufzeichnen, Variablen mit Abfrage beim Start, Schleifen über Zahlen (1,2,3 7-10) oder Texte, Autostart nach dem Verbinden, Ausführung auf mehreren Panes; Auto-Antworten auf bestimmte Ausgaben (siehe unten) |
| Multi-Paste | Text/Befehle an ausgewählte Panes senden: als Block (Bracketed Paste) oder zeilenweise mit Verzögerung, Platzhalter `{{name}}`, `{{host}}`, `{{user}}`, `{{n}}`, Verlauf der letzten 20 Einträge |
| Session-Verwaltung | Seitenleiste mit Ordnern und beliebig tiefen Unterordnern (Rechtsklick → „Neuer Ordner…“ / „Neuer Unterordner…“, Sessions und Ordner per Drag & Drop verschieben), Farben, Filter; Passwörter verschlüsselt über den macOS-Schlüsselbund; Export/Import der gesamten Konfiguration; optional gemeinsame Konfiguration auf einem Netzlaufwerk für alle Macs (siehe unten) |
| Komfort | Quick Connect (`user@host`, `telnet host 2001`, `/dev/cu.usbserial 115200`, `rdp admin@host`), Drag & Drop von Sessions auf Panes (Rand = geteilt öffnen), Ordner „Alle als Kacheln öffnen“, Suche im Puffer, Puffer als Log speichern, Rechtsklick kopieren/einfügen, 4 Farbschemata, Layout-Wiederherstellung |

## Konfiguration exportieren / importieren

Menü **Datei → Gesamte Konfiguration exportieren…** (⇧⌘E) oder in den Einstellungen (⚙). Die JSON-Datei enthält:

- das komplette Adressbuch: alle Sessions mit Ordnern, Farben und sämtlichen Verbindungsoptionen (SSH, Telnet, Seriell, RDP, Befehl)
- alle Einstellungen (Schrift, Farbschema, Verhalten …) inklusive Makros und Auto-Antworten
- Tab-/Split-Layout, eingeklappte Ordner und Multi-Paste-Verlauf
- optional die gespeicherten Passwörter – nur verschlüsselt (AES-256-GCM, Schlüssel per scrypt aus einem Export-Passwort)

**Datei → Konfiguration importieren…** zeigt den Inhalt der Datei und bietet „Zusammenführen“ (gleiche Sessions werden aktualisiert, neue ergänzt, lokale Passwörter bleiben erhalten) oder „Ersetzen“. Einstellungen und Layout lassen sich einzeln abwählen; ein importiertes Layout öffnet sich beim nächsten Start. Ältere Sessions-Exporte (reine JSON-Liste) werden ebenfalls erkannt. SSH-Schlüssel-Passphrasen aus dem macOS-Schlüsselbund werden nicht exportiert.

„Nur Adressbuch exportieren (ohne Passwörter)…“ erzeugt wie bisher eine einfache Sessions-Liste.

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

## Neue Versionen (Update-Hinweis)

MacT-1000 fragt kurz nach dem Start und danach alle 6 Stunden das neueste Release auf GitHub ab ([github.com/denkteich/MacT-1000/releases](https://github.com/denkteich/MacT-1000/releases), „latest“ – Vorabversionen und Entwürfe zählen nicht). Der Start wird dadurch nicht verzögert; ohne Internet passiert einfach nichts.

- Ist dort eine **neuere Version** als die laufende, erscheint oben ein blauer Hinweis „Neue Version verfügbar: MacT-1000 x.y.z“ mit dem Link **Zu MacT-1000 x.y.z** (öffnet die Release-Seite im Browser), **Was ist neu?** (Release-Beschreibung), **Später** (bis zum nächsten Start) und **Überspringen** (diese Version nicht mehr melden; eine noch neuere wird wieder angezeigt).
- **MacT-1000 → Nach Updates suchen…** prüft sofort und zeigt das Ergebnis im Fenster „Version und Konfiguration“: neuestes Release mit Link und Datum, Vergleich mit der laufenden Version („Aktuell“, „Neue Version verfügbar“ oder „Diese Version ist neuer als das letzte Release“) und Zeitpunkt der Prüfung. Schlägt die Prüfung fehl, steht dort der Grund; der zuletzt bekannte Stand bleibt sichtbar.
- Ist die geladene **Konfiguration neuer** als die laufende Version und gibt es ein passendes Release, enthält auch der gelbe Konfigurations-Hinweis einen Link zum Download.
- Abfrage über die GitHub-API; ist deren Limit erreicht (60 Abfragen pro Stunde und IP-Adresse), wird die Version über die Weiterleitung der Release-Seite ermittelt. Gesendet wird nur eine normale Anfrage mit der Kennung `MacT-1000/<Version>`, keine weiteren Daten.
- Abschalten: Einstellungen → „Beim Start und alle 6 Stunden auf GitHub nach einer neuen MacT-1000-Version suchen“ (gilt nur für diesen Mac). „Nach Updates suchen…“ funktioniert weiterhin manuell.

## TFTP-Server

Seitenleisten-Tab **TFTP** (oder ⌥⌘T): Verzeichnis wählen, Port (Standard 69) und Netzwerkadresse festlegen (alle Netzwerke, eine bestimmte Schnittstelle oder nur dieser Mac), **Starten**. Der Server läuft nur, solange er gestartet ist, und wird beim Beenden von MacT-1000 gestoppt. Unten in der Session-Liste zeigt „TFTP läuft“ den Zustand an.

- **Download** (Gerät holt Datei vom Mac, z. B. Firmware): immer erlaubt, nur innerhalb des gewählten Verzeichnisses (inkl. Unterordnern). `..`, absolute Pfade und Symlinks nach außen werden abgewiesen.
- **Upload** (Gerät legt Datei auf dem Mac ab, z. B. `copy running-config tftp://…`): nur mit „Hochladen auf den Mac erlauben“; vorhandene Dateien werden nur mit „Vorhandene Dateien überschreiben“ ersetzt. Unterordner im Dateinamen werden angelegt. Die Datei erscheint erst nach vollständiger Übertragung (vorher als versteckte Teildatei).
- Protokoll: RFC 1350 mit Optionen `blksize`, `tsize`, `timeout` (RFC 2347–2349), Modi `octet` und `netascii`, Dateien über 32 MB (Blocknummer-Überlauf), Wiederholung bei Paketverlust.
- Liste **Übertragungen** mit Fortschritt, Gegenstelle und Fehlermeldung; die angezeigte Adresse samt Beispielbefehl lässt sich per Klick kopieren.
- Hinweise: Beim ersten Start fragt die macOS-Firewall ggf., ob eingehende Verbindungen erlaubt werden. Ist Port 69 belegt (z. B. weil der macOS-eigene `tftpd` aktiviert wurde) oder nicht erlaubt, erscheint eine Meldung – dann einen anderen Port (z. B. 6969) verwenden und am Gerät angeben.

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
- **Nach manueller Anmeldung speichern:** Meldest du dich per SSH oder Telnet von Hand mit Passwort an, blendet MacT-1000 nach erfolgreichem Login oben im Pane ein: „Passwort … speichern?“ mit *Speichern* / *Nicht jetzt* / *Nie für diese Session*. Bei einer Quick-Connect-Verbindung wird dabei die Session mit Passwort angelegt. Wurde das Passwort direkt erneut abgefragt (falsch), wird nichts angeboten; `sudo`-Abfragen werden ignoriert. Abschaltbar unter Einstellungen.
- **Schlüsselbund-Zugriff:** Da die App nicht mit einer Apple-Entwickler-ID signiert ist, fragt macOS nach einem Update evtl. „MacT-1000 möchte auf den Schlüssel „MacT-1000 Safe Storage“ zugreifen“ – mit dem Mac-Passwort und **Immer erlauben** bestätigen. Wird der Zugriff verweigert, bleiben die Passwörter verschlüsselt erhalten (früher gingen sie dabei verloren); die Session zeigt dann „gesperrt“ und das Passwort kann neu eingegeben werden.

## Tastenkürzel

| Kürzel | Aktion |
|---|---|
| ⌘T | Neuer Tab mit lokaler Shell |
| ⌘N | Neue Session |
| ⌘K | Quick Connect |
| ⌘D | Vertikal teilen (nebeneinander) |
| ⇧⌘D | Horizontal teilen (untereinander) |
| ⌥⌘D | Session in neuem Pane duplizieren |
| ⌘R | Getrennte Verbindung neu verbinden – ist sie noch aktiv, wird sie in einem neuen Tab direkt daneben dupliziert |
| ⌥⇧⌘D | Tab duplizieren (gleiche Aufteilung, alle Sessions neu verbunden) |
| ⌘] / ⌘[ | Nächstes / vorheriges Pane im aktuellen Tab |
| ⌘→ / ⌘← | Nächstes / vorheriges Pane über alle Tabs hinweg (nach dem letzten Pane eines Tabs geht es im nächsten Tab weiter) |
| ⇧⌘] / ⇧⌘[ | Nächster / vorheriger Tab, ⌘1–9 direkt |
| ⇧⌘↩ | Pane maximieren |
| ⌥⌘= | Panes gleichmäßig verteilen |
| ⇧⌘I | Multi-Input ein/aus |
| ⇧⌘A | Alle Panes des Tabs für Multi-Input wählen |
| ⇧⌘V | Multi-Paste |
| ⇧⌘M | Makro ausführen |
| ⇧⌘R | Makro-Aufzeichnung starten / stoppen |
| ⌘. | Laufende Makros stoppen |
| ⌘F | Suchen |
| ⌘L | Terminal leeren |
| ⌘W / ⇧⌘W | Pane / Tab schließen |
| ⌘B | Seitenleiste ein/aus |
| ⇧⌘F | Datei-Browser (SCP) für das aktive SSH-Pane |
| ⌥⌘T | TFTP-Server anzeigen |
| ⌘+ / ⌘- / ⌘0 | Schriftgröße |
| ⌥← / ⌥→ | Wort zurück/vor (Zeilenanfang/-ende: fn← / fn→ oder Ctrl+A / Ctrl+E) |

Beendete Sessions lassen sich mit ⌘R neu verbinden (Enter löst bewusst nichts aus, damit kein versehentlicher Neuaufbau passiert). Ist die Verbindung im aktiven Pane noch aktiv, öffnet ⌘R dieselbe Verbindung zusätzlich in einem neuen Tab direkt rechts daneben (lokale Shells im aktuellen Verzeichnis); als geteiltes Pane geht das mit ⌥⌘D.

### Ordner in der Session-Liste

- **Anlegen:** Rechtsklick in die Session-Liste (freie Fläche, auf einen Ordner oder eine Session) → „Neuer Ordner…“. Neue Ordner sind zunächst leer und bleiben auch leer bestehen.
- **Verschieben:** Session mit der Maus auf einen Ordner ziehen (der Ordner wird blau markiert). Auf eine Session in einem Ordner ziehen geht auch. Auf „Sessions (ohne Ordner)“ oder auf die freie Fläche ziehen nimmt die Session aus dem Ordner. Alternativ Rechtsklick auf die Session → „In Ordner verschieben…“.
- **Unterordner:** Rechtsklick auf einen Ordner → „Neuer Unterordner…“ (im Dialog lässt sich der Oberordner auch frei wählen). Beliebig tief verschachtelbar, z. B. `Rechenzentrum › Core › Switche`. Im Session-Dialog kann der Ordner auch als Pfad eingetippt werden: `Rechenzentrum/Core/Switche` – fehlende Ordner werden automatisch angelegt. Ordnernamen dürfen deshalb kein „/“ enthalten.
- **Ordner verschieben:** einen Ordner auf einen anderen ziehen macht ihn (samt Inhalt und Unterordnern) zum Unterordner; auf „Sessions (ohne Ordner)“ ziehen oder Rechtsklick → „Auf oberste Ebene verschieben“ holt ihn nach oben. Jeder Ordner lässt sich einzeln einklappen; die Zahl am Ordner zählt alle Sessions inklusive Unterordnern.
- **Ordner-Rechtsklick:** Alle als Kacheln öffnen (inklusive Unterordner), neue Session direkt in diesem Ordner, neuer Unterordner, umbenennen, löschen. Umbenennen eines Oberordners passt alle Unterordner und Sessions mit an. Beim Löschen werden die enthaltenen Sessions und Unterordner nicht gelöscht, sondern eine Ebene nach oben verschoben (bei einem Ordner der obersten Ebene nach „Sessions“).
- Sessions aus der Liste auf ein Pane zu ziehen öffnet sie wie bisher.
- Leere Ordner werden in den Einstellungen gespeichert und beim Konfigurations-Export mitgenommen.

Rückfrage beim Schließen: Solange SSH-, Telnet- oder serielle Verbindungen aktiv sind, fragt MacT-1000 vor dem Schließen eines Panes, eines Tabs, des Fensters und vor dem Beenden (⌘Q) nach, ob wirklich beendet werden soll. Lokale Shells und RDP (externes Programm) lösen keine Rückfrage aus. Die Rückfrage lässt sich mit **Enter** bestätigen (Verbindung wird getrennt und geschlossen) oder mit Esc abbrechen – auch beim Schließen des Fensters und beim Beenden. Abschaltbar unter Einstellungen → „Vor dem Schließen … bei aktiven Verbindungen nachfragen“.

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
src/store.js      Sessions/Einstellungen (verschlüsselte Passwörter), lokal oder Netzlaufwerk
src/shared.js     Gemeinsame Konfiguration: Sperre, Überwachung, Offline-Abgleich
src/merge3.js     3-Wege-Zusammenführung gleichzeitiger Änderungen
src/tftp.js       TFTP-Server (RFC 1350, blksize/tsize/timeout)
src/version.js    Versionsvergleich für die Konfigurationsversion
src/update.js     Abfrage des neuesten Releases auf GitHub (Update-Hinweis)
renderer/         Oberfläche: Tabs, Split-Layout, Dialoge, Datei-Browser, Makros und Makro-Schleifen (xterm.js)
test/             Unit-, Telnet-, SCP-, TFTP- und End-to-End-Tests
```

Daten liegen unter `~/Library/Application Support/MacT-1000/`.

### Umstieg von MacTerm (bis 1.4.0)

Beim ersten Start übernimmt MacT-1000 automatisch Sessions, Einstellungen, Ordner und Layout aus `~/Library/Application Support/MacTerm/`. Ausnahme: **in der App gespeicherte Passwörter** – sie sind mit einem Schlüssel verschlüsselt, der an den App-Namen gebunden ist, und müssen einmalig neu eingegeben werden. Alternativ in MacTerm „Konfiguration exportieren“ mit Passwörtern wählen und in MacT-1000 importieren. SSH-Schlüssel-Passphrasen im macOS-Schlüsselbund sind nicht betroffen. Die alte `MacTerm.app` kann danach gelöscht werden.
