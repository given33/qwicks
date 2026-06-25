; Custom NSIS script for QWicks installer.
; Electron-builder includes this via nsis.include before generating the
; final installer .nsi file.
;
; ============================================================================
; PROBLEM: full-package (installer) updates + NSIS "please close the app"
; ============================================================================
; When QWicks auto-installs an update it calls electron-updater's
; quitAndInstall(isSilent=true, isForceRunAfter=true). isSilent=true runs the
; NSIS installer with the /S flag.
;
; Critical Windows/NSIS behavior:
;   * /S (silent mode) SKIPS every installer PAGE, including the built-in
;     "application is running" page. electron-builder's NSIS template only
;     invokes the customCheckAppRunning macro FROM that page, so under /S
;     the macro is NEVER called. Any cleanup placed there is dead code on
;     the auto-update path — which is exactly why full-package updates failed
;     with a "cannot close QWicks / please close manually" prompt while no
;     window was visible (the runtime child was a lingering zombie).
;   * The QWicks runtime child (spawned by the GUI as a node-mode subprocess
;     of QWicks.exe) does not die reliably when the parent exits: Windows has
;     no process-group kill semantics for detached:false children, and file
;     handles on resources/app.asar are released by the OS *some time after*
;     the process actually exits. A single taskkill + short sleep leaves a
;     race where app.asar is still locked → the installer fails to overwrite
;     it → update silently fails.
;
; FIX: do ALL process cleanup inside customInit. customInit is called from
; .onInit which runs in EVERY install mode (including /S). The cleanup polls
; tasklist until no QWicks.exe remains (taskkill returns before the OS
; releases file handles, so we must wait for true process death), giving the
; OS time to drop the app.asar lock before the installer starts copying files.
;
; customCheckAppRunning is kept as a no-op fallback: in non-silent mode the
; template still calls it, and an empty body means "do not show the close-app
; dialog" (cleanup already happened in customInit).
; ============================================================================

!macro customInit
  ; Terminate every QWicks process (GUI main + node-mode runtime children)
  ; and WAIT until they are genuinely gone. This runs in ALL install modes
  ; (silent /S included), so the auto-update path is covered here — NOT in
  ; customCheckAppRunning (which /S never invokes).
  StrCpy $R1 0            ; retry counter
  killLoop:
    IntOp $R1 $R1 + 1
    ; /T kills the whole process tree (GUI + spawned runtime child).
    nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
    Pop $0
    Sleep 750
    ; Is any QWicks.exe still alive?
    nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq QWicks.exe" /FO CSV /NH 2>&1'
    Pop $0
    Pop $1                 ; stdout
    ; tasklist prints "INFO: No tasks are running ..." when none found.
    StrCpy $2 $1 4         ; first 4 chars
    ${If} $2 == "INFO"
      Goto killDone
    ${EndIf}
    ; Retry up to 12 times (~13s total). After the process exits, Windows
    ; still needs a beat to release file handles on app.asar; the loop both
    ; confirms process death AND covers that release window.
    ${If} $R1 < 12
      Goto killLoop
    ${EndIf}
  killDone:
!macroend

; No-op: under /S (silent) the template never calls this macro, and in
; interactive mode cleanup already ran in customInit. Returning without
; calling Abort suppresses the built-in "please close QWicks" dialog so the
; install proceeds.
!macro customCheckAppRunning
!macroend
