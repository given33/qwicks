; Custom NSIS script for QWicks installer.
; Electron-builder includes this via nsis.include before generating the
; final installer .nsi file.
;
; Problem: The stock electron-builder NSIS template shows a "please close
; the app" dialog when it detects a running QWicks instance. On Windows,
; the QWicks child server may linger after the GUI closes (zombie process),
; causing the installer to block indefinitely even after the user closes
; the window.
;
; Fix: Two macros work together:
;   1. customInit — runs at installer startup, kills all QWicks processes
;      before any check can run.
;   2. customCheckAppRunning — overrides the built-in running-app page so
;      the dialog is never shown. It kills + verifies processes are gone
;      in a loop (taskkill once is not enough — Windows needs time to
;      release file handles after the process exits).

!macro customInit
  ; Terminate all QWicks processes (main + child qwicks server) silently.
  nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
  Pop $0
  ; Give the OS a moment to release file locks and socket bindings.
  Sleep 2500
!macroend

!macro customCheckAppRunning
  ; Override the built-in check: kill any leftover QWicks processes and
  ; WAIT until they are actually gone (not just until taskkill returns).
  ; taskkill returns before the OS releases file handles, so a single kill
  ; + short sleep leaves a race where the file is still locked. We poll
  ; tasklist until no QWicks.exe remains, up to a bounded retry count.
  StrCpy $R1 0            ; retry counter
  checkRunningLoop:
    IntOp $R1 $R1 + 1
    ; Force-kill every QWicks.exe (and its child tree).
    nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
    Pop $0
    Sleep 1000
    ; Check whether any QWicks.exe is still alive.
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq QWicks.exe" /FO CSV /NH 2>&1'
    Pop $0
    Pop $1                 ; stdout
    ; tasklist prints "INFO: No tasks are running ..." when none found.
    StrCpy $2 $1 4         ; first 4 chars
    ${If} $2 == "INFO"
      Goto checkRunningDone
    ${EndIf}
    ; Still running? Retry up to 8 times (~16s total) before giving up.
    ${If} $R1 < 8
      Goto checkRunningLoop
    ${EndIf}
  checkRunningDone:
  ; Return without ever showing the "please close the app" dialog.
!macroend
