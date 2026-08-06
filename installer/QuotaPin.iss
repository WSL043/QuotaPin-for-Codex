#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
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
OutputBaseFilename=QuotaPin-Setup
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
VersionInfoOriginalFileName=QuotaPin-Setup.exe
VersionInfoProductName=QuotaPin

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
Source: "..\src\codex-process.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\runtime-trust.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\codex-command.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\open-settings.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\first-run.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\ui.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\src\lifecycle.ps1"; DestDir: "{app}\src"; Flags: ignoreversion
Source: "..\config.default.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config.default.json"; DestDir: "{app}"; DestName: "config.json"; Flags: onlyifdoesntexist uninsneveruninstall
Source: "..\VERSION"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\scripts\stop.ps1"; Flags: dontcopy
Source: "..\scripts\check-prerequisites.ps1"; Flags: dontcopy

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "QuotaPin"; ValueData: """{app}\QuotaPin.Tray.exe"""; Flags: uninsdeletevalue; Check: AutoAttachEnabled
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "InstallOwner"; ValueData: "setup"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: dword; ValueName: "InstallSchema"; ValueData: "1"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "InstallVersion"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "OfficialSource"; ValueData: "https://github.com/WSL043/QuotaPin-for-Codex"; Flags: uninsdeletevalue uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\QuotaPin"; ValueType: string; ValueName: "OfficialSupport"; ValueData: "https://github.com/WSL043/QuotaPin-for-Codex/issues"; Flags: uninsdeletevalue uninsdeletekeyifempty

[Icons]
Name: "{userprograms}\QuotaPin\Open QuotaPin settings in Codex"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\src\open-settings.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\QuotaPin.Tray.exe"; Comment: "Open QuotaPin settings inside Codex"
Name: "{userprograms}\QuotaPin\Official project (free source)"; Filename: "https://github.com/WSL043/QuotaPin-for-Codex"; Comment: "Official free and open-source QuotaPin project"
Name: "{userprograms}\QuotaPin\Uninstall QuotaPin"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\QuotaPin.Tray.exe"; Description: "Start QuotaPin"; Flags: nowait; Check: AutoAttachEnabled
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\src\first-run.ps1"""; Flags: runhidden waituntilterminated; Check: RunFirstConnection

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\stop.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopQuotaPin"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\config.json"
Type: files; Name: "{app}\install-state.json"
Type: dirifempty; Name: "{app}"

[InstallDelete]
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
  ExistingSetupInstall: Boolean;
  ExistingAutoAttach: Boolean;

function InitializeSetup: Boolean;
begin
  ExistingSetupInstall := RegKeyExists(HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{D3C316B5-8F18-45DF-98BD-2C9F579D9E24}_is1');
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
  else if ExistingSetupInstall then
    Result := ExistingAutoAttach
  else
    Result := True;
end;

function RunFirstConnection: Boolean;
begin
  Result := (not ExistingSetupInstall) and (not WizardSilent);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopScript: String;
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
begin
  if CurStep <> ssPostInstall then Exit;
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + ExpandConstant('{app}\src\lifecycle.ps1') + '" -Action PrepareSetupMigration',
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  StateText := '{"schema":1,"owner":"setup","version":"{#MyAppVersion}"}';
  SaveStringToFile(ExpandConstant('{app}\install-state.json'), StateText, False);
end;
