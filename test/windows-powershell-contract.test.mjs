import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const powershell = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

test("Windows PowerShell keeps persisted UTC instants and JSON target arrays exact", { skip: process.platform !== "win32" }, () => {
  const script = String.raw`
function Convert-SavedInstant([string]$Value) {
    [DateTimeOffset]::Parse($Value).UtcDateTime
}
$Instant = Convert-SavedInstant '2026-08-04T10:59:05.9782532Z'
$Targets = '[{"url":"app://-/index.html"},{"url":"about:blank"}]' | ConvertFrom-Json
$Count = @($Targets | Where-Object { [string]$_.url -ceq 'app://-/index.html' }).Count
Write-Output ($Instant.ToString('o'))
Write-Output $Count
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  assert.equal(lines[0], "2026-08-04T10:59:05.9782532Z");
  assert.equal(lines[1], "1");
});

test("runtime timestamps retain the same instant when JSON yields strings or DateTime objects", () => {
  const trustPath = path.join(root, "src", "runtime-trust.ps1").replaceAll("'", "''");
  const source = String.raw`
. '${trustPath}'
$AsString = ConvertTo-QuotaPinInstant '2026-08-06T00:28:37.4510202Z'
$AsDate = ConvertTo-QuotaPinInstant ([DateTime]::Parse('2026-08-06T00:28:37.4510202Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind))
[ordered]@{ string = $AsString.ToString('o'); date = $AsDate.ToString('o') } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  for (const executable of ["pwsh.exe", powershell]) {
    const result = spawnSync(executable, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
    if (result.error?.code === "ENOENT" && executable === "pwsh.exe") continue;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const actual = JSON.parse(result.stdout.trim().split(/\r?\n/).findLast((line) => line.startsWith("{")));
    assert.equal(actual.string, "2026-08-06T00:28:37.4510202+00:00");
    assert.equal(actual.date, "2026-08-06T00:28:37.4510202+00:00");
  }
});

test("release and update PowerShell sources parse in Windows PowerShell 5.1", { skip: process.platform !== "win32" }, () => {
  const files = ["scripts/test-windows-arm64-emulation.ps1", "scripts/update.ps1", "scripts/update-launcher.ps1", "scripts/installer-handoff.ps1", "src/runtime-trust.ps1", "src/lifecycle.ps1"]
    .map((relative) => path.join(root, relative).replaceAll("'", "''"));
  const script = String.raw`
$ErrorActionPreference = 'Stop'
foreach ($Path in @('${files.join("','")}')) {
    $Tokens = $null
    $Errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$Tokens, [ref]$Errors)
    if ($Errors.Count) { throw ("{0}: {1}" -f $Path, (($Errors | ForEach-Object Message) -join '; ')) }
}
Write-Output 'parsed'
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /parsed/);
});

test("Windows update launcher hands off to a child that survives the launcher", { skip: process.platform !== "win32" }, async (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "quotapin-update-launcher-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const launcher = path.join(root, "scripts", "update-launcher.ps1");
  const resultPath = path.join(fixture, "logs", "update-result.json");
  const survivedPath = path.join(fixture, "child-survived.txt");
  fs.writeFileSync(path.join(fixture, "update.ps1"), String.raw`param([string]$Version)
$LogRoot = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $LogRoot 'update-result.json'), (@{
  schema = 2
  status = 'started'
  phase = 'preparing'
  version = $Version
  writtenAt = [DateTimeOffset]::Now.ToString('o')
} | ConvertTo-Json -Compress))
Start-Sleep -Milliseconds 750
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'child-survived.txt'), 'yes')
`, "utf8");
  const result = spawnSync(powershell, [
    "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher,
    "-Version", "9.8.7", "-InstallRoot", fixture,
  ], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(fs.readFileSync(resultPath, "utf8")).status, "started");
  const deadline = Date.now() + 4_000;
  while (!fs.existsSync(survivedPath) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.readFileSync(survivedPath, "utf8"), "yes");
});

test("installer handoff publishes one exact hot-resume completion receipt", { skip: process.platform !== "win32" }, () => {
  const handoffPath = path.join(root, "scripts", "installer-handoff.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-handoff-test-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path (Join-Path $Root 'src') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root 'VERSION'), '1.1.0')
    [IO.File]::WriteAllText((Join-Path $Root 'QuotaPin.Agent.exe'), 'fixture')
    @'
function Get-QuotaPinResumableRuntime([string]$InstallRoot, [string]$AgentPath) {
    [pscustomobject]@{
        codexPid = 4242
        codexCreationTimeUtc = '2026-08-09T00:00:00Z'
        port = 43124
        generation = ('a' * 32)
    }
}
function Resume-QuotaPinTrustedRuntime([string]$InstallRoot, $ExpectedRuntime, [string]$AgentPath) {
    if ([int]$ExpectedRuntime.codexPid -ne 4242) { throw 'wrong runtime' }
    'quota-ready'
}
'@ | Set-Content -LiteralPath (Join-Path $Root 'src\runtime-trust.ps1') -Encoding UTF8
    & '${handoffPath}' -Action Capture -InstallRoot $Root -Version '1.1.1'
    $Captured = Test-Path -LiteralPath (Join-Path $Root 'logs\installer-handoff.json')
    & '${handoffPath}' -Action Resume -InstallRoot $Root -Version '1.1.1'
    $Result = Get-Content -Raw -LiteralPath (Join-Path $Root 'logs\installer-handoff-result.json') | ConvertFrom-Json
    $Completion = Get-Content -Raw -LiteralPath (Join-Path $Root 'logs\update-completion.json') | ConvertFrom-Json
    [IO.File]::WriteAllText((Join-Path $Root 'logs\installer-handoff.json'), (@{
        schema = 1
        targetVersion = '1.1.1'
        fromVersion = ''
        capturedAt = [DateTimeOffset]::Now.ToString('o')
        expectedRuntime = @{ codexPid = 4242 }
    } | ConvertTo-Json -Compress))
    & '${handoffPath}' -Action Resume -InstallRoot $Root -Version '1.1.1'
    $Malformed = Get-Content -Raw -LiteralPath (Join-Path $Root 'logs\installer-handoff-result.json') | ConvertFrom-Json
    [ordered]@{
        captured = $Captured
        snapshotRemoved = -not (Test-Path -LiteralPath (Join-Path $Root 'logs\installer-handoff.json'))
        schema = [int]$Result.schema
        status = [string]$Result.status
        phase = [string]$Result.phase
        version = [string]$Result.version
        completionStatus = [string]$Completion.status
        malformedStatus = [string]$Malformed.status
        malformedHasFromVersion = $null -ne $Malformed.PSObject.Properties['fromVersion']
    } | ConvertTo-Json -Compress
}
finally { Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    captured: true,
    snapshotRemoved: true,
    schema: 2,
    status: "succeeded",
    phase: "complete",
    version: "1.1.1",
    completionStatus: "succeeded",
    malformedStatus: "degraded",
    malformedHasFromVersion: false,
  });
});

test("Windows release extraction accepts the exact trust payload and rejects extra entries", { skip: process.platform !== "win32" }, () => {
  const trustPath = path.join(root, "src", "runtime-trust.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${trustPath}'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-release-archive-test-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    $Source = Join-Path $Root 'source'
    New-Item -ItemType Directory -Path $Source -Force | Out-Null
    $Files = @('QuotaPin.Agent.exe','QuotaPin.Agent.exe.sha256','THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt.sha256','OFFICIAL_SOURCE.txt','origin.json','QuotaPin.spdx.json','QuotaPin-release.json','QuotaPin-release.json.sha256','SHA256SUMS','LICENSE') | ForEach-Object {
        $Path = Join-Path $Source $_
        [IO.File]::WriteAllText($Path, ('fixture-' + $_))
        $Path
    }
    $ExtraFixture = Join-Path $Source 'payload.bin'
    [IO.File]::WriteAllText($ExtraFixture, 'extra')
    $Good = Join-Path $Root 'good.zip'
    $GoodChecksum = $Good + '.sha256'
    $Bad = Join-Path $Root 'bad.zip'
    $BadChecksum = $Bad + '.sha256'
    $Output = Join-Path $Root 'output'
    Compress-Archive -LiteralPath $Files -DestinationPath $Good -CompressionLevel Optimal
    $GoodHash = Get-QuotaPinSha256 $Good
    [IO.File]::WriteAllText($GoodChecksum, ($GoodHash + '  QuotaPin-Windows-x64.zip'))
    $null = Expand-QuotaPinReleaseBundle -ArchivePath $Good -ArchiveChecksumPath $GoodChecksum -DestinationRoot $Output
    $GoodAccepted = (Get-Content -Raw -LiteralPath (Join-Path $Output 'QuotaPin.Agent.exe')) -ceq 'fixture-QuotaPin.Agent.exe'
    Compress-Archive -LiteralPath @($Files + $ExtraFixture) -DestinationPath $Bad -CompressionLevel Optimal
    $BadHash = Get-QuotaPinSha256 $Bad
    [IO.File]::WriteAllText($BadChecksum, ($BadHash + '  QuotaPin-Windows-x64.zip'))
    $BadRejected = $false
    try { Expand-QuotaPinReleaseBundle -ArchivePath $Bad -ArchiveChecksumPath $BadChecksum -DestinationRoot (Join-Path $Root 'bad-output') }
    catch { $BadRejected = $true }
    [ordered]@{ goodAccepted = $GoodAccepted; badRejected = $BadRejected } | ConvertTo-Json -Compress
}
finally { Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), { goodAccepted: true, badRejected: true });
});

test("runtime handoff prefers a live Agent but retains the exact verified Codex session when it exits", { skip: process.platform !== "win32" }, () => {
  const trustPath = path.join(root, "src", "runtime-trust.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${trustPath}'
$script:Calls = @()
function Get-QuotaPinTrustedRuntime([string]$InstallRoot, [switch]$RequireAgent, [string]$AgentPath = '') {
    $script:Calls += [bool]$RequireAgent
    if ($RequireAgent) { return $null }
    [pscustomobject]@{ port = 43124; generation = ('a' * 32) }
}
$Fallback = Get-QuotaPinResumableRuntime -InstallRoot 'C:\fixture' -AgentPath 'C:\fixture\QuotaPin.Agent.exe'
$FallbackCalls = @($script:Calls)
$script:Calls = @()
function Get-QuotaPinTrustedRuntime([string]$InstallRoot, [switch]$RequireAgent, [string]$AgentPath = '') {
    $script:Calls += [bool]$RequireAgent
    [pscustomobject]@{ port = 43125; generation = ('b' * 32) }
}
$Strict = Get-QuotaPinResumableRuntime -InstallRoot 'C:\fixture' -AgentPath 'C:\fixture\QuotaPin.Agent.exe'
[ordered]@{
    fallbackPort = [int]$Fallback.port
    fallbackCalls = @($FallbackCalls)
    strictPort = [int]$Strict.port
    strictCalls = @($script:Calls)
} | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    fallbackPort: 43124,
    fallbackCalls: [true, false],
    strictPort: 43125,
    strictCalls: [true],
  });
});

test("runtime handoff waits for a setup-started Agent instead of launching a duplicate", { skip: process.platform !== "win32" }, () => {
  const trustPath = path.join(root, "src", "runtime-trust.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${trustPath}'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-resume-race-test-' + [Guid]::NewGuid().ToString('N'))
try {
    $LogRoot = Join-Path $Root 'logs'
    New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
    $Generation = ('c' * 32)
    $StartedAt = '2026-08-10T00:00:00Z'
    $script:LiveCandidate = [pscustomobject]@{
        generation = $Generation
        codexPid = 4242
        codexCreationTimeUtc = $StartedAt
        agentPid = 4343
        port = 43124
    }
    [IO.File]::WriteAllText(
        (Join-Path $LogRoot 'lifecycle.json'),
        ([ordered]@{ agentPid = 4343; codexPid = 4242; state = 'quota-ready' } | ConvertTo-Json -Compress)
    )
    $script:LookupCount = 0
    $script:StartedDuplicate = $false
    $script:Published = 0
    function Get-QuotaPinTrustedRuntime([string]$InstallRoot, [switch]$RequireAgent, [string]$AgentPath = '') {
        $script:LookupCount++
        if ($RequireAgent -and $script:LookupCount -eq 1) { return $null }
        return $script:LiveCandidate
    }
    function Start-Sleep { param([int]$Milliseconds) }
    function Start-Process {
        $script:StartedDuplicate = $true
        throw 'A duplicate Agent must not be launched.'
    }
    function Publish-QuotaPinResumedAutoAttachGuard {
        param([string]$InstallRoot, $Runtime, [int]$AgentPid)
        $script:Published++
        return 'published'
    }
    $Expected = [pscustomobject]@{
        generation = $Generation
        codexPid = 4242
        codexCreationTimeUtc = $StartedAt
        port = 43124
    }
    $Result = Invoke-QuotaPinTrustedRuntimeResumeLocked -InstallRoot $Root -ExpectedRuntime $Expected -AgentPath (Join-Path $Root 'QuotaPin.Agent.exe')
    [ordered]@{
        result = $Result
        lookups = $script:LookupCount
        startedDuplicate = $script:StartedDuplicate
        published = $script:Published
    } | ConvertTo-Json -Compress
}
finally { Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    result: "quota-ready",
    lookups: 2,
    startedDuplicate: false,
    published: 1,
  });
});

test("a command hot update republishes exact watcher ownership without touching Codex", { skip: process.platform !== "win32" }, () => {
  const trustPath = path.join(root, "src", "runtime-trust.ps1").replaceAll("'", "''");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
. '${trustPath}'
$Root = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-resume-guard-test-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $Root -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root 'install-state.json'), '{"schema":1,"owner":"command","preferences":{"autoAttach":true}}')
    $Runtime = [pscustomobject]@{
        generation = ('a' * 32)
        codexPid = 4242
        codexCreationTimeUtc = '2026-08-10T00:00:00Z'
        port = 43124
    }
    $Result = Publish-QuotaPinResumedAutoAttachGuard -InstallRoot $Root -Runtime $Runtime -AgentPid 4343
    $Guard = Get-Content -Raw -LiteralPath (Join-Path $Root 'logs\auto-attach-guard.json') | ConvertFrom-Json
    [IO.File]::WriteAllText((Join-Path $Root 'install-state.json'), '{"schema":1,"owner":"setup","preferences":{"autoAttach":true}}')
    Remove-Item -LiteralPath (Join-Path $Root 'logs\auto-attach-guard.json') -Force
    $SetupResult = Publish-QuotaPinResumedAutoAttachGuard -InstallRoot $Root -Runtime $Runtime -AgentPid 4343
    [ordered]@{
        result = $Result
        state = [string]$Guard.state
        generation = [string]$Guard.generation
        sameProcess = [int]$Guard.sourcePid -eq 4242 -and [int]$Guard.successorPid -eq 4242
        exactAgent = [int]$Guard.agentPid -eq 4343
        exactPort = [int]$Guard.port -eq 43124
        setupResult = $SetupResult
        setupGuard = Test-Path -LiteralPath (Join-Path $Root 'logs\auto-attach-guard.json')
    } | ConvertTo-Json -Compress
}
finally { Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue }
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-EncodedCommand", encoded], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), {
    result: "published",
    state: "successor-observed",
    generation: "a".repeat(32),
    sameProcess: true,
    exactAgent: true,
    exactPort: true,
    setupResult: "not-required",
    setupGuard: false,
  });
});

test("command updater contract keeps exact platform-package trust, cleanup, and no-restart ownership", () => {
  const updater = fs.readFileSync(path.join(root, "scripts", "update.ps1"), "utf8");
  assert.match(updater, /\$PackageName = "QuotaPin-\$Version\.exe"/);
  assert.match(updater, /\$Assets\.Count -ne 1/);
  assert.match(updater, /\$Release\.immutable -ne \$true/);
  assert.match(updater, /\$AssetDigest -notmatch '\^sha256:/);
  assert.match(updater, /OriginalFilename\)\.Trim\(\) -cne \$PackageName/);
  assert.match(updater, /ConvertTo-QuotaPinWindowsFileVersion \$Version/);
  assert.match(updater, /\$InstallOwner = Get-QuotaPinInstallOwner/);
  assert.match(updater, /if \(\$InstallOwner -eq 'command'\) \{ \$InstallerArguments \+= '\/COMMANDINSTALL=1' \}/);
  assert.match(updater, /'\/DEFERHANDOFF=1'/);
  assert.match(updater, /\$Process\.WaitForExit\(5 \* 60 \* 1000\)/);
  assert.match(updater, /Stop-Process -Id \$Process\.Id -Force/);
  assert.match(updater, /\.Length -ne \$ExpectedBytes/);
  assert.doesNotMatch(updater, /Start-Process -FilePath \$PackagePath[^\r\n]*-Wait/);
  assert.match(updater, /'\/NORESTART'/);
  assert.match(updater, /Local\\QuotaPin\.Update\./);
  assert.match(updater, /Write-QuotaPinUpdateResult 'degraded'/);
  assert.match(updater, /Resume-QuotaPinTrustedRuntime/);
  assert.match(updater, /update-completion\.json/);
  assert.match(updater, /cleanup-warning temp-root/);
  assert.doesNotMatch(updater, /Start-Process[^\r\n]*(?:ChatGPT|Codex\.exe|launch\.ps1)/i);
});
