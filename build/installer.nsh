; MacT-1000 für Windows – Ergänzungen zum Installer
;  - mact1000://-Links für das eigene Benutzerkonto registrieren (gleiches Format wie die App selbst)
;  - frühere wint1000://-Links (Windows-Ausgabe bis 1.5.23) ebenfalls hierher leiten
;  - eine vorhandene frühere Installation (WinT-1000, eigene Kennung) still entfernen;
;    die Daten bleiben erhalten und werden beim ersten Start von MacT-1000 übernommen
!define LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\622e9e34-2e63-5fcb-9b40-bd5f71fbc4de"

!macro customInstall
  ReadRegStr $R0 HKCU "${LEGACY_UNINSTALL_KEY}" "QuietUninstallString"
  ReadRegStr $R1 HKCU "${LEGACY_UNINSTALL_KEY}" "InstallLocation"
  ${if} $R0 != ""
  ${andIf} $R1 != ""
  ${andIf} $R1 != $INSTDIR
    DetailPrint "Frühere Version (WinT-1000) wird entfernt: $R1"
    ExecWait '$R0 /KEEP_APP_DATA _?=$R1'
    Delete "$R1\Uninstall WinT-1000.exe"
    RMDir "$R1"
    DeleteRegKey HKCU "${LEGACY_UNINSTALL_KEY}"
    Delete "$DESKTOP\WinT-1000.lnk"
    Delete "$SMPROGRAMS\WinT-1000.lnk"
  ${endIf}
  WriteRegStr HKCU "Software\Classes\mact1000" "" "URL:MacT-1000"
  WriteRegStr HKCU "Software\Classes\mact1000" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\mact1000\DefaultIcon" "" "$INSTDIR\MacT-1000.exe,0"
  WriteRegStr HKCU "Software\Classes\mact1000\shell\open\command" "" '"$INSTDIR\MacT-1000.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\wint1000" "" "URL:MacT-1000"
  WriteRegStr HKCU "Software\Classes\wint1000" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\wint1000\DefaultIcon" "" "$INSTDIR\MacT-1000.exe,0"
  WriteRegStr HKCU "Software\Classes\wint1000\shell\open\command" "" '"$INSTDIR\MacT-1000.exe" "%1"'
!macroend

; beim Deinstallieren entfernen – nicht bei einem Update
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ReadRegStr $0 HKCU "Software\Classes\mact1000\shell\open\command" ""
    StrCmp $0 '"$INSTDIR\MacT-1000.exe" "%1"' 0 +2
      DeleteRegKey HKCU "Software\Classes\mact1000"
    ReadRegStr $0 HKCU "Software\Classes\wint1000\shell\open\command" ""
    StrCmp $0 '"$INSTDIR\MacT-1000.exe" "%1"' 0 +2
      DeleteRegKey HKCU "Software\Classes\wint1000"
  ${endIf}
!macroend
