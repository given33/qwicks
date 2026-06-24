; Custom NSIS script for QWicks installer.
; Electron-builder includes this via nsis.include before generating the
; final installer .nsi file.
;
; Problem: The stock electron-builder NSIS template shows a "please close
; the app" dialog when it detects a running QWicks instance. On Windows,
; the qwicks child server may linger after the GUI closes, causing the
; installer to block indefinitely even after the user closes the window.
;
; Fix: Two macros work together:
;   1. customInit — runs at installer startup, kills all QWicks processes
;      before any check can run.
;   2. customCheckAppRunning — overrides the built-in running-app page so
;      the dialog is never shown, even if a process somehow survived.

!macro customInit
  ; Terminate all QWicks processes (main + child qwicks server) silently.
  nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
  Pop $0
  ; Give the OS a moment to release file locks and socket bindings.
  Sleep 2500
!macroend

!macro customCheckAppRunning
  ; Override the built-in check: silently kill any leftover processes
  ; and never show the "please close the app" dialog.
  nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
  Pop $0
  Sleep 2000
  ; Return without blocking — let the installation proceed.
!macroend
