-- MacT-1000 aus AppleScript (Skripteditor, Kurzbefehle „AppleScript ausführen“) aufrufen
-- Variante 1: über das Kommandozeilen-Werkzeug
do shell script "/Applications/MacT-1000.app/Contents/Resources/bin/mact1000 --local --run 'uptime'"

-- Variante 2: über einen Link (Leerzeichen als %20)
-- open location "mact1000://ssh/admin@10.0.0.1?run=show%20version&split=right"
