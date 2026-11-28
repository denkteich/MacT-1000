# MacT-1000 aus PowerShell aufrufen. Pfad zur EXE anpassen.
$mact = Join-Path $env:LOCALAPPDATA 'Programs\MacT-1000\MacT-1000.exe'
if (-not (Test-Path $mact)) { $mact = Join-Path $PSScriptRoot '..\MacT-1000-1.6.0-portable.exe' }
& $mact --ssh admin@10.0.0.1 --run 'show version' --split right
# Ausgabe protokollieren und danach schliessen:
# & $mact --ssh admin@10.0.0.1 --run 'show running-config' --log "$env:USERPROFILE\Logs\core-sw01.log" --close 3
# Feste Plaetze: erster Aufruf oben, naechster unten im selben geteilten Tab:
# & $mact --ssh admin@10.0.0.1 --layout core --slot oben
# & $mact --ssh admin@10.0.0.2 --layout core --slot unten
# Link-Variante:
# Start-Process 'mact1000://local?run=Get-ChildItem'
