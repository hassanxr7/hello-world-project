; Extra NSIS steps for the Afuufow installer (electron-builder `nsis.include`).
; - The installer is per-user: no administrator rights are needed and nothing outside the user profile is changed.
; - Uninstalling asks whether to delete Afuufow's saved data (memory, face/voice templates, visitor log, keys).

!macro customInit
  ; stop a running copy so files can be replaced (update = run the new installer over the old one; data is kept)
  nsExec::Exec 'taskkill /F /IM "Afuufow.exe" /T'
!macroend

!macro customUnInstall
  ; remove the "start with Windows" entry that the app created
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Afuufow"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.afuufow.assistant"
  ${ifNot} ${isUpdated}
    IfSilent skipDataPrompt
    MessageBox MB_YESNO|MB_ICONQUESTION "Delete Afuufow's saved data too?$\r$\n$\r$\n(memory, face and voice templates, visitor log, API keys, WhatsApp/YouTube sign-ins)$\r$\n$\r$\nYes = delete everything     No = keep it for a later reinstall$\r$\n$\r$\nHaa = tirtir xogta oo dhan     Maya = ha tirtirin" IDNO skipDataPrompt
      RMDir /r "$APPDATA\Afuufow"
      RMDir /r "$LOCALAPPDATA\Afuufow"
    skipDataPrompt:
  ${endIf}
!macroend
