; Custom NSIS script for QWicks installer.
; Electron-builder includes this via nsis.include before generating the
; final installer .nsi file.
;
; The stock electron-builder NSIS template shows a "please close the app"
; dialog when it detects a running instance. On Windows the QWicks main
; process + its child qwicks server may take several seconds to fully exit
; even after the user closes the GUI, causing a deadlock:
;   installer shows dialog → user closes app → installer still sees process → stuck
;
; Instead of that dialog, we forcefully terminate any leftover QWicks
; processes (including orphaned child processes) before the check runs.

!macro customInit
  ; Terminate all QWicks processes (main + child qwicks server) silently
  ; so the installer never sees a "running app" and never blocks.
  nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
  Pop $0
  ; Give the OS a moment to release file locks and socket bindings.
  Sleep 2500
!macroend
