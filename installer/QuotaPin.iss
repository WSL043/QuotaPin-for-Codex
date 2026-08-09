#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#ifndef MyFileVersion
  #define MyFileVersion "0.0.0.0"
#endif

[Setup]
AppId={{D3C316B5-8F18-45DF-98BD-2C9F579D9E24}
AppName=QuotaPin
AppVersion={#MyAppVersion}
AppPublisher=QuotaPin
AppComments=Free and open source: https://github.com/WSL043/QuotaPin-for-Codex
AppContact=https://github.com/WSL043/QuotaPin-for-Codex/issues
AppPublisherURL=https://github.com/WSL043/QuotaPin-for-Codex
AppSupportURL=https://github.com/WSL043/QuotaPin-for-Codex/issues
AppUpdatesURL=https://github.com/WSL043/QuotaPin-for-Codex/releases
DefaultDirName={localappdata}\QuotaPin
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=QuotaPin-{#MyAppVersion}
SetupIconFile=..\assets\quotapin.ico
UninstallDisplayIcon={app}\QuotaPin.Tray.exe
UninstallDisplayName=QuotaPin
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=no
RestartApplications=no
MinVersion=10.0.19041
VersionInfoCompany=QuotaPin contributors
VersionInfoCopyright=Copyright (c) 2026 WSL043
VersionInfoDescription=QuotaPin | https://github.com/WSL043/QuotaPin-for-Codex
VersionInfoOriginalFileName=QuotaPin-{#MyAppVersion}.exe
VersionInfoProductName=QuotaPin
VersionInfoProductVersion={#MyFileVersion}
VersionInfoVersion={#MyFileVersion}

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "ja"; MessagesFile: "compiler:Languages\Japanese.isl"

[CustomMessages]
en.ReadyMessage=QuotaPin is ready. It will reconnect to an already prepared Codex automatically. For a first connection, keep working and reopen Codex when convenient.
ja.ReadyMessage=QuotaPin の準備ができました。接続準備済みの Codex には自動で再接続します。初回接続では、そのまま作業を続け、都合のよい時に Codex を開き直してください。

[Files]
Source: "..\dist\QuotaPin.Tray.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\QuotaPin.Agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\THIRD_PARTY_NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\OFFICIAL_SOURCE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\origin.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\src\launch.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\auto-attach.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\auto-attach-policy.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\codex-process.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\runtime-trust.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\codex-command.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\first-run.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\ui.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\lifecycle.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\config.default.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config.default.json"; DestDir: "{app}"; DestName: "config.json"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\update.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\stop.ps1"; Flags: dontcopy
Source: "..\scripts\check-prerequisites.ps1"; Flags: dontcopy
Source: "..\scripts\installer-handoff.ps1"; Flags: dontcopy

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "QuotaPin"; ValueData: "{code:GetAutoAttachCommand}"; Flags: uninsdeletevalue; Check: AutoAttachEnabled
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "InstallOwner"; ValueData: "{code:GetInstallOwner}"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: dword; ValueName: "InstallSchema"; ValueData: "1"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "InstallVersion"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "OfficialSource"; ValueData: "https://github.com/WSL043/QuotaPin-for-Codex"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "OfficialSupport"; ValueData: "https://github.com/WSL043/QuotaPin-for-Codex/issues"; Flags: uninsdeletevalue uninsdeletekeyifempty

[Icons]
Name: "{userprograms}\QuotaPin\Official project (free source)"; Filename: "https://github.com/WSL043/QuotaPin-for-Codex"; Comment: "Official free and open-source QuotaPin project"
Name: "{userprograms}\QuotaPin\Uninstall QuotaPin"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{tmp}\installer-handoff.ps1"" -Action Resume -InstallRoot ""{app}"" -Version ""{#MyAppVersion}"""; Flags: runhidden waituntilterminated; Check: RunUpdateHandoff
Filename: "{app}\QuotaPin.Tray.exe"; Description: "Start QuotaPin"; Flags: nowait; Check: RunTrayCompanion
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\src\auto-attach.ps1"" -IgnoreExisting"; Flags: runhidden nowait; Check: RunCommandWatcher
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\src\first-run.ps1"""; Flags: runhidden waituntilterminated; Check: RunFirstConnection

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\stop.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopQuotaPin"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\install-state.json"
Type: dirifempty; Name: "{app}"

[InstallDelete]
; An explicit install or update is the repair boundary for a previously
; latched automatic-attachment transaction.  The replacement watcher starts
; with -IgnoreExisting, so clearing only this QuotaPin-owned guard cannot
; interrupt the already-running Codex session.
Type: files; Name: "{app}\logs\auto-attach-guard.json"
Type: files; Name: "{userstartup}\QuotaPin Auto Attach.lnk"
Type: filesandordirs; Name: "{app}\runtime"
Type: filesandordirs; Name: "{app}\src\core"
Type: files; Name: "{app}\src\injector.mjs"
Type: files; Name: "{app}\src\cleanup.mjs"
Type: files; Name: "{app}\src\runtime.ps1"
Type: files; Name: "{app}\src\auto-attach.ps1"
Type: files; Name: "{app}\uninstall.ps1"

[Code]
var
  ExistingInstall: Boolean;
  ExistingSetupInstall: Boolean;
  ExistingAutoAttach: Boolean;
  ExistingInstallOwner: String;
  ExistingRunCommand: String;

function InitializeSetup: Boolean;
begin
  ExistingInstall := RegKeyExists(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{D3C316B5-8F18-45DF-98BD-2C9F579D9E24}_is1');
  { Both supported flavors have a native uninstall registration.  Ownership is
    therefore read from QuotaPin's explicit state, with the startup command as
    a legacy hint and setup as the fail-safe for an ambiguous old install. }
  ExistingSetupInstall := ExistingInstall;
  if RegQueryStringValue(HKCU, 'Software\QuotaPin', 'InstallOwner', ExistingInstallOwner) then
    ExistingSetupInstall := CompareText(ExistingInstallOwner, 'setup') = 0
  else if RegQueryStringValue(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Run', 'QuotaPin', ExistingRunCommand) then
  begin
    if Pos('QuotaPin.Tray.exe', ExistingRunCommand) > 0 then
      ExistingSetupInstall := True
    else if Pos('auto-attach.ps1', ExistingRunCommand) > 0 then
      ExistingSetupInstall := False;
  end;
  ExistingAutoAttach := RegValueExists(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Run', 'QuotaPin');
  Result := True;
end;

function HasCommandLineSwitch(const Name: String): Boolean;
var
  Index: Integer;
begin
  Result := False;
  for Index := 1 to ParamCount do
    if CompareText(ParamStr(Index), Name) = 0 then
    begin
      Result := True;
      Exit;
    end;
end;

function AutoAttachEnabled: Boolean;
begin
  if HasCommandLineSwitch('/DISABLEAUTOATTACH=1') then
    Result := False
  else if ExistingInstall then
    Result := ExistingAutoAttach
  else
    Result := True;
end;

function CommandInstallMode: Boolean;
begin
  { Old command updaters always passed COMMANDINSTALL.  An existing native
    Setup registration is the stronger ownership signal and must survive an
    in-place upgrade instead of silently changing to watcher-only mode. }
  Result := HasCommandLineSwitch('/COMMANDINSTALL=1') and (not ExistingSetupInstall);
end;

function GetInstallOwner(Param: String): String;
begin
  if CommandInstallMode then
    Result := 'command'
  else
    Result := 'setup';
end;

function GetAutoAttachCommand(Param: String): String;
begin
  if CommandInstallMode then
    Result := '"' + ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe') +
      '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
      ExpandConstant('{app}\src\auto-attach.ps1') + '"'
  else
    Result := '"' + ExpandConstant('{app}\QuotaPin.Tray.exe') + '"';
end;

function RunTrayCompanion: Boolean;
begin
  Result := AutoAttachEnabled and (not CommandInstallMode);
end;

function RunCommandWatcher: Boolean;
begin
  Result := AutoAttachEnabled and CommandInstallMode;
end;

function RunFirstConnection: Boolean;
begin
  Result := (not CommandInstallMode) and (not ExistingInstall) and (not WizardSilent);
end;

function RunUpdateHandoff: Boolean;
begin
  Result := (not HasCommandLineSwitch('/DEFERHANDOFF=1')) and
    FileExists(ExpandConstant('{app}\logs\installer-handoff.json'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopScript: String;
  HandoffScript: String;
  CheckScript: String;
  CheckResult: String;
  CheckResultText: AnsiString;
begin
  Result := '';
  ExtractTemporaryFile('check-prerequisites.ps1');
  CheckScript := ExpandConstant('{tmp}\check-prerequisites.ps1');
  CheckResult := ExpandConstant('{tmp}\quotapin-prerequisites.txt');
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + CheckScript + '" -ResultPath "' + CheckResult + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode <> 0 then
  begin
    if FileExists(CheckResult) and LoadStringFromFile(CheckResult, CheckResultText) then
      Result := CheckResultText
    else
      Result := 'QuotaPin prerequisites could not be verified.';
    Exit;
  end;

  { Capturing a resumable session is best-effort and never blocks installation.
    Resume revalidates the exact Codex PID, creation time, CDP endpoint and
    generation after the new files are committed. }
  if not HasCommandLineSwitch('/DEFERHANDOFF=1') then
  begin
    ExtractTemporaryFile('installer-handoff.ps1');
    HandoffScript := ExpandConstant('{tmp}\installer-handoff.ps1');
    Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + HandoffScript +
      '" -Action Capture -InstallRoot "' + ExpandConstant('{app}') +
      '" -Version "{#MyAppVersion}"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;

  ExtractTemporaryFile('stop.ps1');
  StopScript := ExpandConstant('{tmp}\stop.ps1');
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + StopScript + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := 'QuotaPin could not start its update cleanup. Nothing was installed.';
    Exit;
  end;
  if ResultCode <> 0 then
  begin
    Result := 'QuotaPin could not close its current background process. Nothing was installed. Please exit QuotaPin and try again.';
    Exit;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := ExpandConstant('{cm:ReadyMessage}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  StateText: AnsiString;
  AutoAttachText: String;
begin
  if CurStep <> ssPostInstall then Exit;
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + ExpandConstant('{app}\src\lifecycle.ps1') + '" -Action PrepareSetupMigration',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if AutoAttachEnabled then
    AutoAttachText := 'true'
  else
    AutoAttachText := 'false';
  StateText := '{"schema":1,"owner":"' + GetInstallOwner('') + '","version":"{#MyAppVersion}","preferences":{"autoAttach":' + AutoAttachText + '}}';
  SaveStringToFile(ExpandConstant('{app}\install-state.json'), StateText, False);
end;
