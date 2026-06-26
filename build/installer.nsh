; Custom NSIS script for QWicks installer.
; Electron-builder includes this via nsis.include before generating the
; final installer .nsi file.
;
; IMPORTANT: keep this file pure ASCII (no em-dash, no CJK, no smart quotes).
; makensis runs in ANSI mode and aborts the !include on any non-ASCII byte
; ("Bad text encoding"), which silently drops BOTH macros below -- so neither
; process cleanup (customInit) nor the appRunning-dialog suppression
; (customCheckAppRunning) takes effect. That was the root cause of the false
; "QWicks is running / please close it" dialog even when no QWicks process
; existed.
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
;     the auto-update path.
;   * The QWicks runtime child (spawned by the GUI as a node-mode subprocess
;     of QWicks.exe) does not die reliably when the parent exits: Windows has
;     no process-group kill semantics for detached:false children, and file
;     handles on resources/app.asar are released by the OS *some time after*
;     the process actually exits. A single taskkill + short sleep leaves a
;     race where app.asar is still locked, so the installer fails to
;     overwrite it and the update silently fails.
;
; FIX: do ALL process cleanup inside customInit. customInit is called from
; .onInit which runs in EVERY install mode (including /S). The cleanup polls
; taskkill until no QWicks.exe remains, giving the OS time to drop the
; app.asar lock before the installer starts copying files.
;
; IMPORTANT - locale independence: the kill loop MUST NOT match tasklist's
; stdout text (e.g. "INFO: No tasks running"). On non-English Windows that
; string is localized (Chinese systems print it in CJK), so a text match
; never succeeds and the loop spins forever, falsely concluding the app is
; still running and surfacing a false "please close QWicks" dialog. Judge
; completion by taskkill's EXIT CODE instead: 0 = killed, 128 = nothing to
; kill (both mean "no QWicks left"); any other code = real failure (retry).
; ============================================================================

!macro customInit
  ; Terminate every QWicks process (GUI main + node-mode runtime children)
  ; and WAIT until they are genuinely gone. This runs in ALL install modes
  ; (silent /S included), so the auto-update path is covered here -- NOT in
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
    ; 0 (killed) or 128 (nothing to kill) -> no QWicks.exe is left running.
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

; App-running check. customInit already terminated every QWicks process, so
; the built-in _CHECK_APP_RUNNING (which can surface a false "QWicks is
; running" dialog when its Get-CimInstance query misbehaves, e.g. on localized
; Windows) is pure noise here. Defining customCheckAppRunning makes the
; template's !ifmacrodef branch fire and call THIS macro instead of
; _CHECK_APP_RUNNING, so we re-kill defensively and never Abort (never block
; the install).
!macro customCheckAppRunning
  ; Defensive: kill any QWicks that reappeared between customInit and here.
  nsExec::Exec 'taskkill /F /IM QWicks.exe /T 2>&1'
  Pop $0
  Pop $1
  Sleep 500
  ; Deliberately do NOT call Abort -- that would cancel the install. Falling
  ; through lets the install proceed unconditionally.
!macroend
