; Installer hooks of the nq-lab terminal (bundle.windows.nsis.installerHooks; 03 sections 13.1 and 14, 04 D5.4).
;
; What they do, for ANY install folder, default or chosen (the VS Code user setup and Chrome per-user pattern):
;   0. The default folder is %LOCALAPPDATA%\Programs\<product> (the bundler's own default, %LOCALAPPDATA%\<product>, moves
;      under Programs on the folder page and in a silent install with no /D=); a folder the person chooses is never moved.
;   1. Before anything is written, the target is refused when it is not a full path on a local drive, when it is a
;      drive root, a network (UNC or mapped network drive) path, a folder under Program Files or Windows, a link or
;      junction, or an existing file. Silent installers (/S /D=<folder>) exit with code 3 and write nothing; the
;      folder page of the setup greys out its Install button for the same targets.
;   2. NSIS_HOOK_PREINSTALL gives the folder a protected DACL before the first file is written: the current user,
;      SYSTEM and Administrators with full control (inherited by the files), inheritance from the parent removed and
;      no other principal (CWE-732: a folder that inherits Users or Everyone write lets another user replace the
;      exe or WebView2Loader.dll, CWE-427). icacls is called by its full path under the system folder, never through
;      the search path, with a quoted folder and its exit code checked (exit code 4 when the DACL cannot be set).
;   3. NSIS_HOOK_POSTINSTALL reads the folder and the files back through the security API and fails the install,
;      removing what it wrote (exit code 5), unless the DACL is protected and holds exactly those principals and the
;      folder and each file are owned by the user, SYSTEM or Administrators (an owner can always rewrite the DACL).
;      An existing target folder owned by anyone else is refused with exit code 3 before icacls runs.
;   4. The folder is created, with every missing parent, by the first section (-NqtTargetGuard) with its final descriptor
;      in the same call, before the template's SetOutPath could create it with what the parent grants; an existing folder
;      gets the descriptor in one call. An existing folder that holds anything but the product files (an .exe,
;      WebView2Loader.dll, uninstall.exe) owned by the user, SYSTEM or Administrators is refused with exit code 3, and the
;      read-back fails with exit code 5 on any other entry (a planted dwmapi.dll would load into the exe, CWE-427).
; The uninstaller needs no hook: the template deletes only the files the installer wrote and removes the folder
; with a plain RMDir, which keeps anything else in it. Neither the installer nor the uninstaller touches the lab.
;
; This file is included near the top of installer.nsi, before the product defines, so no function here may use
; ${PRODUCTNAME}, ${MAINBINARYNAME} or another define of the template; the macros at the end are expanded where
; the template inserts them and may use them. Keep it pure ASCII, with no byte order mark: the unicode NSIS build
; reads a file without one as the ANSI code page.

!include LogicLib.nsh

Var NqtPath
Var NqtBase
Var NqtMain
Var NqtMessage
Var NqtCode
Var NqtMode
Var NqtCommand
Var NqtSidSystem
Var NqtSidAdmins
Var NqtSidUser
Var NqtSidTrusted
Var NqtSidOwner
Var NqtOwnerPtr
Var NqtAncestor
Var NqtUserText
Var NqtSd
Var NqtDir
Var NqtCreated

!define NQT_CODE_REFUSED 3
!define NQT_CODE_DACL_FAILED 4
!define NQT_CODE_DACL_WRONG 5

!define NQT_MSG_FULL "Choose a full folder path on a local drive, such as C:\Users\you\AppData\Local\Programs\nq-lab terminal."
!define NQT_MSG_ROOT "The install folder cannot be the root of a drive. Choose a folder inside it."
!define NQT_MSG_NETWORK "The install folder cannot be on a network location. Choose a folder on a local drive."
!define NQT_MSG_SYSTEM "The install folder cannot be under Program Files or Windows. Choose a folder in your own profile or on another drive."
!define NQT_MSG_LINK "The install folder cannot be a link, a junction or an existing file. Choose an ordinary folder."
!define NQT_MSG_PARENT "The install folder is inside a folder that another account can change or replace, or whose owner cannot be trusted. Choose a folder in your own profile."
!define NQT_MSG_CONTENT "The install folder holds something that is not part of this program, or a file of another account. A planted DLL would load into the program on every launch. Choose a new, empty folder."
!define NQT_MSG_CHARS "The install folder contains a character that Windows does not allow in a folder name."
!define NQT_MSG_OWNER "The install folder belongs to another account, which could change its permissions after the install. Choose a new folder or one that you own."

; ---- the target rules -------------------------------------------------------------------------------------------------
; In: $NqtPath. Out: $NqtMessage ("" when the target is acceptable) and $NqtPath, normalised, when it is.

Function NqtTrimSlashes
  trim_again:
    StrCpy $0 $NqtPath 1 -1
    StrCmp $0 "\" trim_one
    StrCmp $0 "/" trim_one
    Return
  trim_one:
    StrCpy $NqtPath $NqtPath -1
    Goto trim_again
FunctionEnd

; In: $NqtPath and $NqtBase. Out: $0 is "1" when the path is the base or lies under it (not case sensitive).
Function NqtIsUnder
  StrLen $1 $NqtBase
  IntOp $1 $1 + 1
  StrCpy $2 "$NqtPath\"
  StrCpy $2 $2 $1
  StrCmp $2 "$NqtBase\" 0 +3
    StrCpy $0 "1"
    Return
  StrCpy $0 "0"
FunctionEnd

; In and out: $NqtPath, with the 8.3 short names (PROGRA~1) of its existing part written out in full. A folder that
; does not exist yet has no long form, so the nearest existing parent is expanded and the rest is appended.
Function NqtExpandShortNames
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $3 $NqtPath
  StrCpy $4 ""
  expand_again:
    StrLen $0 $3
    ${If} $0 <= 3
      Goto expand_done
    ${EndIf}
    StrCpy $2 $3
    System::Call 'kernel32::GetLongPathNameW(w r2, w .r1, i ${NSIS_MAX_STRLEN}) i .r0'
    ${If} $0 > 0
      StrCpy $NqtPath "$1$4"
      Goto expand_done
    ${EndIf}
    ; Move the last segment of $3 to the front of $4.
    StrLen $0 $3
    cut_loop:
      IntOp $0 $0 - 1
      StrCpy $1 $3 1 $0
      StrCmp $1 "\" cut_found
      IntCmp $0 0 expand_done cut_loop cut_loop
    cut_found:
    StrCpy $2 $3 "" $0
    StrCpy $4 "$2$4"
    StrCpy $3 $3 $0
    Goto expand_again
  expand_done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function NqtCheckTarget
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $NqtMessage ""
  Call NqtTrimSlashes
  StrCpy $0 $NqtPath 2
  StrCmp $0 "\\" is_network
  StrCmp $0 "//" is_network
  StrCmp $NqtPath "" is_full
  StrLen $1 $NqtPath
  ${If} $1 = 2
    StrCpy $0 $NqtPath 1 1
    StrCmp $0 ":" is_root is_full
  ${EndIf}
  StrCpy $0 $NqtPath 1 1
  StrCmp $0 ":" 0 is_full
  StrCpy $0 $NqtPath 1 2
  StrCmp $0 "\" +3
  StrCmp $0 "/" +2
  Goto is_full
  StrCpy $2 0
  chars_loop:
    StrCmp $2 $1 chars_done
    StrCpy $0 $NqtPath 1 $2
    StrCmp $0 '"' is_chars
    StrCmp $0 "*" is_chars
    StrCmp $0 "?" is_chars
    StrCmp $0 "<" is_chars
    StrCmp $0 ">" is_chars
    StrCmp $0 "|" is_chars
    IntOp $2 $2 + 1
    Goto chars_loop
  chars_done:
  ; The full, long form of the path: dot segments, forward slashes and short names cannot hide a rule.
  StrCpy $3 $NqtPath
  System::Call 'kernel32::GetFullPathNameW(w r3, i ${NSIS_MAX_STRLEN}, w .r1, p 0) i .r0'
  StrCmp $0 0 is_full
  StrCpy $NqtPath $1
  Call NqtTrimSlashes
  Call NqtExpandShortNames
  StrCpy $0 $NqtPath 2
  StrCmp $0 "\\" is_network
  StrLen $1 $NqtPath
  StrCmp $1 2 is_root
  ; A mapped network drive is a network path too.
  StrCpy $3 $NqtPath 3
  System::Call 'kernel32::GetDriveTypeW(w r3) i .r0'
  StrCmp $0 4 is_network
  StrCmp $0 1 is_full
  ; Program Files and Windows (the 32 bit and 64 bit Program Files, and the Windows folder itself).
  StrCpy $NqtBase "$WINDIR"
  Call NqtIsUnder
  StrCmp $0 "1" is_system
  StrCpy $NqtBase "$PROGRAMFILES"
  Call NqtIsUnder
  StrCmp $0 "1" is_system
  StrCpy $NqtBase "$PROGRAMFILES32"
  Call NqtIsUnder
  StrCmp $0 "1" is_system
  StrCpy $NqtBase "$PROGRAMFILES64"
  Call NqtIsUnder
  StrCmp $0 "1" is_system
  ; A link or junction at the folder itself, or an existing file, is refused (CWE-59).
  StrCpy $3 $NqtPath
  System::Call 'kernel32::GetFileAttributesW(w r3) i .r0'
  ${If} $0 <> -1
    IntOp $1 $0 & 0x400
    ${If} $1 <> 0
      Goto is_link
    ${EndIf}
    IntOp $1 $0 & 0x10
    ${If} $1 = 0
      Goto is_link
    ${EndIf}
    ; An existing folder must be owned by the user, Administrators or SYSTEM: its owner can rewrite its DACL later (CWE-732).
    Call NqtCheckFolderOwner
    StrCmp $NqtMessage "" 0 check_done
  ${EndIf}
  ; Every existing parent below the drive root: no link, a trusted owner, no other account that can delete or replace it.
  Call NqtCheckAncestors
  Goto check_done
  is_full:
    StrCpy $NqtMessage "${NQT_MSG_FULL}"
    Goto check_done
  is_root:
    StrCpy $NqtMessage "${NQT_MSG_ROOT}"
    Goto check_done
  is_network:
    StrCpy $NqtMessage "${NQT_MSG_NETWORK}"
    Goto check_done
  is_system:
    StrCpy $NqtMessage "${NQT_MSG_SYSTEM}"
    Goto check_done
  is_link:
    StrCpy $NqtMessage "${NQT_MSG_LINK}"
    Goto check_done
  is_chars:
    StrCpy $NqtMessage "${NQT_MSG_CHARS}"
  check_done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; The folder page: Install stays greyed out for a refused target (no dialog, the page calls this on every change).
; A silent install must NOT be judged here: NSIS answers an invalid /D= folder by quietly falling back to the default
; folder, which would install somewhere the caller did not ask for. The first section refuses it instead (exit code 3).
Function .onVerifyInstDir
  ${If} ${Silent}
    Return
  ${EndIf}
  StrCpy $NqtPath $INSTDIR
  Call NqtCheckTarget
  ${If} $NqtMessage != ""
    Abort
  ${EndIf}
FunctionEnd

; Stops the install with $NqtMessage and the exit code $NqtCode, before or after files were written.
Function NqtStopInstall
  ${If} ${Silent}
    System::Call 'kernel32::AttachConsole(i -1) i .r0'
    ${If} $0 <> 0
      System::Call 'kernel32::GetStdHandle(i -11) i .r0'
      FileWrite $0 "$NqtMessage$\r$\n"
    ${EndIf}
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "$NqtMessage"
  ${EndIf}
  SetErrorLevel $NqtCode
  Abort "$NqtMessage"
FunctionEnd

; Out: $NqtBase, the folder after /D= on the command line ("" when there is none). NSIS removes /D= from $CMDLINE, so
; the raw command line is read. NSIS itself also drops a /D= folder that
; it does not like (a network path, a path with forward slashes, a drive that does not exist) and falls back to the
; default folder without a word, so a silent install judges what the caller asked for, not what NSIS made of it.
Function NqtReadRequestedDir
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $NqtBase ""
  System::Call 'kernel32::GetCommandLineW() w .r3'
  StrLen $0 $3
  StrCpy $1 0
  requested_loop:
    IntCmp $1 $0 requested_done 0 requested_done
    StrCpy $2 $3 3 $1
    StrCmp $2 "/D=" requested_found
    IntOp $1 $1 + 1
    Goto requested_loop
  requested_found:
    IntOp $1 $1 + 3
    StrCpy $NqtBase $3 "" $1
  requested_done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; The default folder (the VS Code user setup and Chrome per-user pattern). The bundler's per-user default is
; %LOCALAPPDATA%\<product>; this moves it to %LOCALAPPDATA%\Programs\<product>. In and out: $INSTDIR. Only a folder that
; is one segment under %LOCALAPPDATA% moves (not Programs itself, not a deeper folder, not another drive), so a folder
; the person chose is never changed.
Function NqtDefaultUnderPrograms
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $0 "$LOCALAPPDATA\"
  StrLen $1 $0
  StrCpy $2 $INSTDIR $1
  StrCmp $2 $0 0 default_done
  StrCpy $3 $INSTDIR "" $1
  StrCmp $3 "" default_done
  StrCmp $3 "Programs" default_done
  StrCpy $2 0
  default_scan:
    StrCpy $4 $3 1 $2
    StrCmp $4 "" default_move
    StrCmp $4 "\" default_done
    StrCmp $4 "/" default_done
    IntOp $2 $2 + 1
    Goto default_scan
  default_move:
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\$3"
  default_done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; The folder page shows the default the template set in .onInit. MUI2 owns .onGUIInit and calls the function named by
; MUI_CUSTOMFUNCTION_GUIINIT (the template defines none), so the rule is attached there, not as a second .onGUIInit.
!define MUI_CUSTOMFUNCTION_GUIINIT NqtGuiInit
Function NqtGuiInit
  Call NqtDefaultUnderPrograms
FunctionEnd

; The first section of the installer (the template's own sections come later in the file): refuses a target before
; the WebView2 section or the folder creation of the install section can touch anything. A silent install with no /D=
; takes the same default as the folder page does.
Section "-NqtTargetGuard"
  ${If} ${Silent}
    Call NqtReadRequestedDir
    ${If} $NqtBase == ""
      Call NqtDefaultUnderPrograms
    ${EndIf}
  ${EndIf}
  StrCpy $NqtPath $INSTDIR
  ${If} ${Silent}
    ${If} $NqtBase != ""
      StrCpy $NqtPath $NqtBase
    ${EndIf}
  ${EndIf}
  Call NqtCheckTarget
  ${If} $NqtMessage != ""
    StrCpy $NqtCode ${NQT_CODE_REFUSED}
    Call NqtStopInstall
  ${EndIf}
  StrCpy $INSTDIR $NqtPath
SectionEnd

; The second section: creates the accepted folder with its final permissions (see NqtPrepareInstallDir). It is a section of
; its own, with an index, so that a test of the guard alone can switch it off and leave the profile untouched.
Section "-NqtPrepareFolder" NqtSecPrepare
  Call NqtPrepareInstallDir
SectionEnd

; ---- the principals ---------------------------------------------------------------------------------------------------

; Out: $NqtUserText, the SID of the user running the installer, as text (S-1-5-21-...), "" when it cannot be read.
Function NqtReadUserSid
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $NqtUserText ""
  System::Call 'kernel32::GetCurrentProcess() p .r0'
  System::Call 'advapi32::OpenProcessToken(p r0, i 8, *p .r1) i .r2'
  ${If} $2 <> 0
    System::Call 'advapi32::GetTokenInformation(p r1, i 1, p 0, i 0, *i .r3) i .r2'
    System::Alloc $3
    Pop $4
    System::Call 'advapi32::GetTokenInformation(p r1, i 1, p r4, i r3, *i .r3) i .r2'
    ${If} $2 <> 0
      System::Call '*$4(p .r5)'
      System::Call 'advapi32::ConvertSidToStringSidW(p r5, *p .r0) i .r2'
      ${If} $2 <> 0
        System::Call 'kernel32::lstrcpyW(w .r3, p r0) p'
        StrCpy $NqtUserText $3
        System::Call 'kernel32::LocalFree(p r0)'
      ${EndIf}
    ${EndIf}
    System::Free $4
    System::Call 'kernel32::CloseHandle(p r1)'
  ${EndIf}
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Runs $NqtCommand (a full command line) without a shell or a window and stops the install with code 4 when its
; exit code is not 0.
Function NqtRunIcacls
  Push $0
  Push $1
  nsExec::ExecToStack '$NqtCommand'
  Pop $0
  Pop $1
  ${If} $0 != 0
    StrCpy $NqtMessage "The permissions of the install folder could not be set (icacls exit code $0). Choose another folder."
    DetailPrint "$NqtCommand"
    DetailPrint "$1"
    StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
    Call NqtStopInstall
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; The protected DACL: reset (drops every explicit rule), grant the three principals, drop inheritance. The grant
; comes before the removal of inheritance so that the user never loses the right to finish the job.
Function NqtProtectInstallDir
  Call NqtReadUserSid
  ${If} $NqtUserText == ""
    StrCpy $NqtMessage "The account running the installer could not be identified, so the install folder cannot be protected."
    StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
    Call NqtStopInstall
  ${EndIf}
  CreateDirectory "$INSTDIR"
  ; No /reset of the folder here: that would hand it back to the parent's rules until /inheritance:r runs. The guard
  ; section already gave it the final descriptor in one call; the two steps below only confirm it.
  StrCpy $NqtCommand '"$SYSDIR\icacls.exe" "$INSTDIR" /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F *$NqtUserText:(OI)(CI)F /Q'
  Call NqtRunIcacls
  StrCpy $NqtCommand '"$SYSDIR\icacls.exe" "$INSTDIR" /inheritance:r /Q'
  Call NqtRunIcacls
  ; Files left by an earlier install keep their own rules otherwise.
  StrCpy $NqtPath "$INSTDIR\$NqtMain"
  IfFileExists "$NqtPath" 0 +3
    StrCpy $NqtCommand '"$SYSDIR\icacls.exe" "$NqtPath" /reset /Q'
    Call NqtRunIcacls
  StrCpy $NqtPath "$INSTDIR\WebView2Loader.dll"
  IfFileExists "$NqtPath" 0 +3
    StrCpy $NqtCommand '"$SYSDIR\icacls.exe" "$NqtPath" /reset /Q'
    Call NqtRunIcacls
  StrCpy $NqtPath "$INSTDIR\uninstall.exe"
  IfFileExists "$NqtPath" 0 +3
    StrCpy $NqtCommand '"$SYSDIR\icacls.exe" "$NqtPath" /reset /Q'
    Call NqtRunIcacls
FunctionEnd

; ---- the read-back ------------------------------------------------------------------------------------------------------
; In: $NqtPath and $NqtMode ("dir" or "file"). Out: $NqtMessage, "" when the DACL is as it must be: only Allow rules for
; SYSTEM, Administrators and the user; for a folder also protected, with all three present, inherited by children and
; with full control, and no inherited rule.
Function NqtCheckAcl
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $NqtMessage ""
  StrCpy $9 $NqtPath
  ; 5 = owner and DACL: the owner can always rewrite the DACL (READ_CONTROL and WRITE_DAC), so it is judged too (CWE-732).
  System::Call 'advapi32::GetNamedSecurityInfoW(w r9, i 1, i 5, *p .r16, p 0, *p .r1, p 0, *p .r2) i .r0'
  ${If} $0 <> 0
    StrCpy $NqtMessage "The permissions of $NqtPath could not be read (error $0)."
    Goto acl_end
  ${EndIf}
  StrCpy $NqtOwnerPtr $R6
  Call NqtOwnerTrusted
  ${If} $0 = 0
    StrCpy $NqtMessage "$NqtPath is owned by an account other than the user, SYSTEM and Administrators."
    Goto acl_free
  ${EndIf}
  ${If} $1 = 0
    StrCpy $NqtMessage "$NqtPath has no DACL, so everyone could write to it."
    Goto acl_free
  ${EndIf}
  ${If} $NqtMode == "dir"
    StrCpy $3 0
    StrCpy $4 0
    System::Call 'advapi32::GetSecurityDescriptorControl(p r2, *i .r3, *i .r4) i .r0'
    IntOp $3 $3 & 0x1000
    ${If} $3 = 0
      StrCpy $NqtMessage "$NqtPath still inherits permissions from its parent folder."
      Goto acl_free
    ${EndIf}
  ${EndIf}
  System::Alloc 12
  Pop $4
  System::Call 'advapi32::GetAclInformation(p r1, p r4, i 12, i 2) i .r0'
  System::Call '*$4(i .r5)'
  System::Free $4
  StrCpy $R2 0
  StrCpy $R3 0
  StrCpy $R4 0
  StrCpy $6 0
  ace_loop:
    IntCmp $6 $5 ace_done ace_next ace_done
  ace_next:
    System::Call 'advapi32::GetAce(p r1, i r6, *p .r7) i .r0'
    ${If} $0 = 0
      StrCpy $NqtMessage "A permission rule of $NqtPath could not be read."
      Goto acl_free
    ${EndIf}
    System::Call '*$7(&i1 .r8, &i1 .r9, &i2 .r15, &i4 .r10)'
    IntOp $R1 $7 + 8
    ${If} $8 <> 0
      StrCpy $NqtMessage "$NqtPath holds a rule that is not an Allow rule."
      Goto acl_free
    ${EndIf}
    ${If} $NqtMode == "dir"
      IntOp $R5 $9 & 0x10
      ${If} $R5 <> 0
        StrCpy $NqtMessage "$NqtPath holds an inherited rule."
        Goto acl_free
      ${EndIf}
      IntOp $R5 $9 & 3
      ${If} $R5 <> 3
        StrCpy $NqtMessage "$NqtPath holds a rule that its files and folders do not inherit."
        Goto acl_free
      ${EndIf}
      IntOp $R5 $R0 & 0x1F01FF
      ${If} $R5 <> 0x1F01FF
        StrCpy $NqtMessage "$NqtPath holds a rule that is not full control."
        Goto acl_free
      ${EndIf}
    ${EndIf}
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidSystem) i .r0'
    ${If} $0 <> 0
      StrCpy $R2 1
      Goto ace_matched
    ${EndIf}
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidAdmins) i .r0'
    ${If} $0 <> 0
      StrCpy $R3 1
      Goto ace_matched
    ${EndIf}
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidUser) i .r0'
    ${If} $0 <> 0
      StrCpy $R4 1
      Goto ace_matched
    ${EndIf}
    StrCpy $NqtMessage "$NqtPath holds a rule for a principal other than the user, SYSTEM and Administrators."
    Goto acl_free
  ace_matched:
    IntOp $6 $6 + 1
    Goto ace_loop
  ace_done:
  ${If} $NqtMode == "dir"
    ${If} $R2 = 0
    ${OrIf} $R3 = 0
      StrCpy $NqtMessage "$NqtPath lacks the rule for SYSTEM or for Administrators."
      Goto acl_free
    ${EndIf}
    ${If} $R4 = 0
    ${AndIf} $NqtUserText != "S-1-5-18"
      StrCpy $NqtMessage "$NqtPath lacks the rule for the current user."
    ${EndIf}
  ${EndIf}
  acl_free:
  System::Call 'kernel32::LocalFree(p r2)'
  acl_end:
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Builds the three SIDs the folder may name and frees them again.
Function NqtMakeSids
  Push $0
  System::Call 'advapi32::ConvertStringSidToSidW(w "S-1-5-18", *p .s)'
  Pop $NqtSidSystem
  System::Call 'advapi32::ConvertStringSidToSidW(w "S-1-5-32-544", *p .s)'
  Pop $NqtSidAdmins
  StrCpy $0 $NqtUserText
  System::Call 'advapi32::ConvertStringSidToSidW(w r0, *p .s)'
  Pop $NqtSidUser
  System::Call 'advapi32::ConvertStringSidToSidW(w "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464", *p .s)'
  Pop $NqtSidTrusted
  ; The account that may own the install folder and its files. NQT_TEST_OWNER_SID exists only so that a test can make a
  ; folder look planted by another account (a foreign owner cannot be set without a privilege); the shipped installer
  ; never defines it, and then the owner is the user running the installer.
!ifdef NQT_TEST_OWNER_SID
  StrCpy $0 "${NQT_TEST_OWNER_SID}"
!else
  StrCpy $0 $NqtUserText
!endif
  System::Call 'advapi32::ConvertStringSidToSidW(w r0, *p .s)'
  Pop $NqtSidOwner
  Pop $0
FunctionEnd

Function NqtFreeSids
  System::Call 'kernel32::LocalFree(p $NqtSidSystem)'
  System::Call 'kernel32::LocalFree(p $NqtSidAdmins)'
  System::Call 'kernel32::LocalFree(p $NqtSidUser)'
  System::Call 'kernel32::LocalFree(p $NqtSidTrusted)'
  System::Call 'kernel32::LocalFree(p $NqtSidOwner)'
FunctionEnd

; In: $NqtOwnerPtr, the owner SID of a folder or file (call NqtMakeSids first). Out: $0, "1" when it is the user running
; the installer, Administrators or SYSTEM, "0" for any other account, for no owner, or when the user could not be named.
; The owner holds READ_CONTROL and WRITE_DAC whatever the DACL says, so an owner outside this set can re-grant itself write.
Function NqtOwnerTrusted
  StrCpy $0 0
  StrCmp $NqtOwnerPtr 0 owner_end
  System::Call 'advapi32::EqualSid(p $NqtOwnerPtr, p $NqtSidSystem) i .r0'
  StrCmp $0 0 0 owner_end
  System::Call 'advapi32::EqualSid(p $NqtOwnerPtr, p $NqtSidAdmins) i .r0'
  StrCmp $0 0 0 owner_end
  StrCmp $NqtSidOwner 0 owner_end
  System::Call 'advapi32::EqualSid(p $NqtOwnerPtr, p $NqtSidOwner) i .r0'
  owner_end:
FunctionEnd

; In: $NqtPath, an existing folder. Out: $NqtMessage, "" when its owner is the user, Administrators or SYSTEM. An owner that
; cannot be read counts as foreign: the permissions could not be set either.
Function NqtCheckFolderOwner
  Push $0
  Push $1
  Push $2
  Push $3
  StrCpy $NqtMessage ""
  Call NqtReadUserSid
  Call NqtMakeSids
  StrCpy $3 $NqtPath
  System::Call 'advapi32::GetNamedSecurityInfoW(w r3, i 1, i 1, *p .r1, p 0, p 0, p 0, *p .r2) i .r0'
  ${If} $0 <> 0
    StrCpy $NqtMessage "${NQT_MSG_OWNER}"
  ${Else}
    StrCpy $NqtOwnerPtr $1
    Call NqtOwnerTrusted
    ${If} $0 = 0
      StrCpy $NqtMessage "${NQT_MSG_OWNER}"
    ${EndIf}
    System::Call 'kernel32::LocalFree(p r2)'
  ${EndIf}
  Call NqtFreeSids
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; In: $NqtAncestor, an existing or missing folder. Out: $NqtMessage, "" when it is acceptable as a parent of the install
; folder (call NqtMakeSids first). A missing folder is fine (the install creates it). Refused: a link or junction
; (CWE-59), an owner other than the user, SYSTEM, Administrators or TrustedInstaller, no DACL, and any Allow rule
; that applies to the folder itself for another principal and grants delete-child (0x40), change-permissions (0x40000),
; take-ownership (0x80000) or all rights (0x10000000): with one of those the other account can rename the protected
; install folder away and plant its own (CWE-732; delete-child on the parent overrides the child's DACL).
; Known limit: DELETE (0x10000) on the parent is not tested. A parent that grants another account Modify, as D:\ does to
; its children through Authenticated Users, lets that account rename the parent away (with add-subdirectory on the
; grandparent) and plant its own folder; testing it would refuse every folder below D:\ that inherits Modify, the test
; trees under D:\dev included. The hand-over documents this (single-account PC, or the profile default).
Function NqtCheckOneAncestor
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1
  Push $R5
  StrCpy $NqtMessage ""
  StrCpy $9 $NqtAncestor
  System::Call 'kernel32::GetFileAttributesW(w r9) i .r0'
  StrCmp $0 -1 anc_end
  IntOp $1 $0 & 0x400
  ${If} $1 <> 0
    StrCpy $NqtMessage "${NQT_MSG_LINK}"
    Goto anc_end
  ${EndIf}
  System::Call 'advapi32::GetNamedSecurityInfoW(w r9, i 1, i 5, *p .r2, p 0, *p .r3, p 0, *p .r4) i .r0'
  ${If} $0 <> 0
    StrCpy $NqtMessage "${NQT_MSG_PARENT}"
    Goto anc_end
  ${EndIf}
  ${If} $2 = 0
  ${OrIf} $3 = 0
    StrCpy $NqtMessage "${NQT_MSG_PARENT}"
    Goto anc_free
  ${EndIf}
  System::Call 'advapi32::EqualSid(p r2, p $NqtSidUser) i .r0'
  ${If} $0 = 0
    System::Call 'advapi32::EqualSid(p r2, p $NqtSidSystem) i .r0'
  ${EndIf}
  ${If} $0 = 0
    System::Call 'advapi32::EqualSid(p r2, p $NqtSidAdmins) i .r0'
  ${EndIf}
  ${If} $0 = 0
    System::Call 'advapi32::EqualSid(p r2, p $NqtSidTrusted) i .r0'
  ${EndIf}
  ${If} $0 = 0
    StrCpy $NqtMessage "${NQT_MSG_PARENT}"
    Goto anc_free
  ${EndIf}
  System::Alloc 12
  Pop $1
  System::Call 'advapi32::GetAclInformation(p r3, p r1, i 12, i 2) i .r0'
  System::Call '*$1(i .r5)'
  System::Free $1
  StrCpy $6 0
  anc_loop:
    IntCmp $6 $5 anc_free anc_next anc_free
  anc_next:
    System::Call 'advapi32::GetAce(p r3, i r6, *p .r7) i .r0'
    ${If} $0 = 0
      StrCpy $NqtMessage "${NQT_MSG_PARENT}"
      Goto anc_free
    ${EndIf}
    System::Call '*$7(&i1 .r8, &i1 .r9, &i2 .r15, &i4 .r10)'
    IntOp $R1 $7 + 8
    IntOp $6 $6 + 1
    ; Only Allow rules (type 0) that apply to this folder (not inherit-only, flag 0x8) matter here.
    StrCmp $8 0 0 anc_loop
    IntOp $R5 $9 & 0x8
    StrCmp $R5 0 0 anc_loop
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidUser) i .r0'
    StrCmp $0 0 0 anc_loop
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidSystem) i .r0'
    StrCmp $0 0 0 anc_loop
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidAdmins) i .r0'
    StrCmp $0 0 0 anc_loop
    System::Call 'advapi32::EqualSid(p r11, p $NqtSidTrusted) i .r0'
    StrCmp $0 0 0 anc_loop
    IntOp $R5 $R0 & 0x100C0040
    StrCmp $R5 0 anc_loop
    StrCpy $NqtMessage "${NQT_MSG_PARENT}"
  anc_free:
  System::Call 'kernel32::LocalFree(p r4)'
  anc_end:
  Pop $R5
  Pop $R1
  Pop $R0
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; In: $NqtPath (full path, long names, no trailing slash). Out: $NqtMessage, "" when every existing parent below the
; drive root passes NqtCheckOneAncestor. The folder itself is judged by the caller and gets its own DACL later.
Function NqtCheckAncestors
  Push $0
  Push $1
  Push $2
  StrCpy $NqtMessage ""
  Call NqtReadUserSid
  ${If} $NqtUserText == ""
    StrCpy $NqtMessage "${NQT_MSG_PARENT}"
    Goto anc_all_done
  ${EndIf}
  Call NqtMakeSids
  StrLen $1 $NqtPath
  StrCpy $2 3
  anc_all_loop:
    IntCmp $2 $1 anc_all_free anc_all_check anc_all_free
  anc_all_check:
    StrCpy $0 $NqtPath 1 $2
    StrCmp $0 "\" 0 anc_all_next
    StrCpy $NqtAncestor $NqtPath $2
    Call NqtCheckOneAncestor
    StrCmp $NqtMessage "" 0 anc_all_free
  anc_all_next:
    IntOp $2 $2 + 1
    Goto anc_all_loop
  anc_all_free:
  Call NqtFreeSids
  anc_all_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; ---- the folder, created with its final security descriptor ---------------------------------------------------------------
; The template's SetOutPath creates a missing folder with what its parent grants, before the PREINSTALL hook runs, and
; three icacls processes need a few hundred milliseconds to undo that. Another account that watches the parent can drop a
; file into the folder in that window, and the file keeps its own owner and rules (a dwmapi.dll beside the exe loads into
; the program on every launch, CWE-427). So the first section of the installer (-NqtTargetGuard) creates the folder, and
; every missing parent, with the final descriptor in the same call, and sets that descriptor on an existing folder in one
; call; the template's SetOutPath then finds the folder there. An existing folder is refused (exit code 3) unless it
; holds only product files, and the read-back after the install fails (exit code 5) on anything else in the folder.

; Out: $NqtSd, a security descriptor (LocalAlloc) with the protected DACL: SYSTEM, Administrators and the user with full
; control that the files inherit, nothing else, nothing inherited from the parent; 0 when it could not be built.
Function NqtMakeFinalSd
  Push $0
  Push $1
  StrCpy $1 "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"
  ${If} $NqtUserText != "S-1-5-18"
    StrCpy $1 "$1(A;OICI;FA;;;$NqtUserText)"
  ${EndIf}
  System::Call 'advapi32::ConvertStringSecurityDescriptorToSecurityDescriptorW(w r1, i 1, *p .r0, p 0) i .r1'
  ${If} $1 = 0
    StrCpy $NqtSd 0
  ${Else}
    StrCpy $NqtSd $0
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; In: $NqtDir, $NqtSd. Creates the folder with the descriptor. Out: $0 is 1 when it was created here, 0 when it already
; existed, -1 on failure (and $1 holds the Windows error code).
Function NqtMakeDirWithSd
  Push $2
  Push $3
  System::Alloc 12
  Pop $2
  System::Call '*$2(i 12, p $NqtSd, i 0)'
  StrCpy $3 $NqtDir
  System::Call 'kernel32::CreateDirectoryW(w r3, p r2) i .r0 ? e'
  Pop $1
  System::Free $2
  ${If} $0 <> 0
    StrCpy $0 1
  ${ElseIf} $1 = 183
    StrCpy $0 0
  ${Else}
    StrCpy $0 -1
  ${EndIf}
  Pop $3
  Pop $2
FunctionEnd

; In: $NqtDir, $NqtSd. Out: $0 as NqtMakeDirWithSd; a folder that exists is left alone.
Function NqtEnsureDir
  Push $2
  StrCpy $2 $NqtDir
  System::Call 'kernel32::GetFileAttributesW(w r2) i .r0'
  ${If} $0 <> -1
    StrCpy $0 0
  ${Else}
    Call NqtMakeDirWithSd
  ${EndIf}
  Pop $2
FunctionEnd

; In: $NqtPath (a full path on a local drive, no trailing backslash) and $NqtSd. Creates every missing folder from the top
; down, each with the final descriptor. Out: $NqtCreated, "1" when the install folder itself was created here, "0" when it
; was there already. A folder that cannot be created stops the install with exit code 4 and nothing written.
Function NqtCreateTree
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrLen $4 $NqtPath
  StrCpy $3 3
  tree_loop:
    IntCmp $3 $4 tree_leaf tree_scan tree_leaf
  tree_scan:
    StrCpy $2 $NqtPath 1 $3
    StrCmp $2 "\" 0 tree_next
    StrCpy $NqtDir $NqtPath $3
    Call NqtEnsureDir
    StrCmp $0 -1 tree_failed
  tree_next:
    IntOp $3 $3 + 1
    Goto tree_loop
  tree_leaf:
  StrCpy $NqtDir $NqtPath
  Call NqtEnsureDir
  StrCmp $0 -1 tree_failed
  StrCpy $NqtCreated $0
  Goto tree_done
  tree_failed:
  StrCpy $NqtMessage "The install folder $NqtDir could not be created with protected permissions (error $1). Choose another folder."
  StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
  Call NqtStopInstall
  tree_done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; In: $NqtPath, an existing folder, and $NqtSd. Replaces its whole DACL with the final one in a single call (protected,
; so nothing is inherited), which also drops the rules of the files below it that came from the folder. Stops the install
; with exit code 4 when that fails.
Function NqtApplyFinalDacl
  Push $0
  Push $1
  Push $2
  Push $3
  System::Call 'advapi32::GetSecurityDescriptorDacl(p $NqtSd, *i .r1, *p .r2, *i .r3) i .r0'
  StrCpy $3 $NqtPath
  System::Call 'advapi32::SetNamedSecurityInfoW(w r3, i 1, i 0x80000004, p 0, p 0, p r2, p 0) i .r0'
  ${If} $0 <> 0
    StrCpy $NqtMessage "The permissions of the install folder could not be set (error $0). Choose another folder."
    StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
    Call NqtStopInstall
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; In: $NqtPath, the install folder, and $NqtMain ("" before the PREINSTALL hook has named the program: any .exe then
; counts as the program of an earlier install). Call NqtMakeSids first. Out: $NqtMessage, "" when the folder holds nothing
; but ordinary files named like the program, WebView2Loader.dll or uninstall.exe that the user, SYSTEM or Administrators
; own. Every other entry (a DLL, a manifest, a .local folder, a link) is a way to load code into the program (CWE-427).
Function NqtCheckFolderContents
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  StrCpy $NqtMessage ""
  StrCpy $2 $NqtPath
  System::Call 'advapi32::GetNamedSecurityInfoW(w r2, i 1, i 1, *p .r3, p 0, p 0, p 0, *p .r4) i .r5'
  ${If} $5 <> 0
    StrCpy $NqtMessage "${NQT_MSG_CONTENT}"
    Goto contents_end
  ${EndIf}
  StrCpy $NqtOwnerPtr $3
  Call NqtOwnerTrusted
  System::Call 'kernel32::LocalFree(p r4)'
  ${If} $0 = 0
    StrCpy $NqtMessage "${NQT_MSG_CONTENT}"
    Goto contents_end
  ${EndIf}
  FindFirst $6 $1 "$NqtPath\*"
  contents_loop:
    StrCmp $1 "" contents_done
    StrCmp $1 "." contents_next
    StrCmp $1 ".." contents_next
    StrCmp $1 "WebView2Loader.dll" contents_known
    StrCmp $1 "uninstall.exe" contents_known
    StrCmp $NqtMain "" 0 contents_exact
    StrCpy $2 $1 4 -4
    StrCmp $2 ".exe" contents_known contents_foreign
  contents_exact:
    StrCmp $1 $NqtMain contents_known contents_foreign
  contents_known:
    StrCpy $2 "$NqtPath\$1"
    System::Call 'kernel32::GetFileAttributesW(w r2) i .r3'
    IntOp $3 $3 & 0x410
    StrCmp $3 0 0 contents_foreign
    System::Call 'advapi32::GetNamedSecurityInfoW(w r2, i 1, i 1, *p .r3, p 0, p 0, p 0, *p .r4) i .r5'
    StrCmp $5 0 0 contents_foreign
    StrCpy $NqtOwnerPtr $3
    Call NqtOwnerTrusted
    System::Call 'kernel32::LocalFree(p r4)'
    StrCmp $0 0 contents_foreign contents_next
  contents_foreign:
    StrCpy $NqtMessage "${NQT_MSG_CONTENT} ($1)"
    Goto contents_done
  contents_next:
    FindNext $6 $1
    Goto contents_loop
  contents_done:
  FindClose $6
  contents_end:
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Runs in the first section of the installer, once the target is accepted: $INSTDIR is created (with every missing parent)
; with its final descriptor, or an existing folder is judged by its contents and owner, given the descriptor and judged
; again (a file dropped in the meantime cannot survive that second look, because nobody else can add one after the first
; call). Stops the install with exit code 3 (refused) or 4 (the descriptor cannot be set).
Function NqtPrepareInstallDir
  Push $0
  StrCpy $NqtMain ""
  StrCpy $NqtPath $INSTDIR
  Call NqtReadUserSid
  ${If} $NqtUserText == ""
    StrCpy $NqtMessage "The account running the installer could not be identified, so the install folder cannot be protected."
    StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
    Call NqtStopInstall
  ${EndIf}
  Call NqtMakeSids
  Call NqtMakeFinalSd
  ${If} $NqtSd == 0
    StrCpy $NqtMessage "The permissions for the install folder could not be prepared. Choose another folder."
    StrCpy $NqtCode ${NQT_CODE_DACL_FAILED}
    Call NqtStopInstall
  ${EndIf}
  Call NqtCreateTree
  ${If} $NqtCreated == "0"
    Call NqtCheckFolderContents
    ${If} $NqtMessage != ""
      StrCpy $NqtCode ${NQT_CODE_REFUSED}
      Call NqtStopInstall
    ${EndIf}
    Call NqtApplyFinalDacl
    Call NqtCheckFolderContents
    ${If} $NqtMessage != ""
      StrCpy $NqtCode ${NQT_CODE_REFUSED}
      Call NqtStopInstall
    ${EndIf}
  ${EndIf}
  System::Call 'kernel32::LocalFree(p $NqtSd)'
  Call NqtFreeSids
  Pop $0
FunctionEnd

; Reads back the folder and the three files the install wrote; $NqtMessage is "" when all are as they must be.
Function NqtVerifyInstallDir
  Call NqtReadUserSid
  Call NqtMakeSids
  StrCpy $NqtMode "dir"
  StrCpy $NqtPath "$INSTDIR"
  Call NqtCheckAcl
  StrCmp $NqtMessage "" 0 verify_done
  StrCpy $NqtMode "file"
  StrCpy $NqtPath "$INSTDIR\$NqtMain"
  Call NqtCheckAcl
  StrCmp $NqtMessage "" 0 verify_done
  StrCpy $NqtPath "$INSTDIR\WebView2Loader.dll"
  IfFileExists "$NqtPath" 0 +3
    Call NqtCheckAcl
    StrCmp $NqtMessage "" 0 verify_done
  StrCpy $NqtPath "$INSTDIR\uninstall.exe"
  Call NqtCheckAcl
  StrCmp $NqtMessage "" 0 verify_done
  ; Nothing but the three files may sit in the folder (a planted DLL loads into the exe on every launch, CWE-427).
  StrCpy $NqtPath "$INSTDIR"
  Call NqtCheckFolderContents
  verify_done:
  Call NqtFreeSids
FunctionEnd

; ---- the hooks ----------------------------------------------------------------------------------------------------------

!macro NSIS_HOOK_PREINSTALL
  StrCpy $NqtMain "${MAINBINARYNAME}.exe"
  Call NqtProtectInstallDir
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Call NqtVerifyInstallDir
  ${If} $NqtMessage != ""
    ; Take back what this install wrote: the three files, the folder when it is then empty, and the registry entries.
    Delete "$INSTDIR\${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\WebView2Loader.dll"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"
    DeleteRegKey SHCTX "${UNINSTKEY}"
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    StrCpy $NqtMessage "The install was undone because the folder permissions are not as required. $NqtMessage"
    StrCpy $NqtCode ${NQT_CODE_DACL_WRONG}
    Call NqtStopInstall
  ${EndIf}
!macroend
