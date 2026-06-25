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
; taskkill until no QWicks.exe remains, giving the OS time to drop the
; app.asar lock before the installer starts copying files.
;
; IMPORTANT — locale independence: the kill loop MUST NOT match tasklist's
; stdout text (e.g. "INFO: No tasks running"). On non-English Windows that
; string is localized (中文系统输出"信息: 没有运行的任务..."), so a text
; match never succeeds and the loop spins forever, falsely concluding the app
; is still running → false "please close QWicks" dialog. Judge completion by
; taskkill's EXIT CODE instead: 0 = killed, 128 = nothing to kill (both mean
; "no QWicks left"); any other code = real failure (retry).
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
    ; nsExec::ExecToStack pushes the exit code on TOP, then the stdout output
    ; beneath it. Exit code: 0 = killed something, 128 = no matching process,
    ; anything else = transient failure (e.g. access denied while shutting down).
    nsExec::ExecToStack 'taskkill /F /IM QWicks.exe /T 2>&1'
    Pop $0                 ; exit code (top of stack)
    Pop $R2                ; stdout output (discarded)
    ; 0 (killed) or 128 (nothing to kill) → no QWicks.exe is left running.
    ${If} $0 == 0
    ${OrIf} $0 == 128
      Goto killDone
    ${EndIf}
    Sleep 750
    ; Retry up to 12 times (~13s total) for transient access-denied while a
    ; process is mid-shutdown, and to let Windows release app.asar handles.
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
