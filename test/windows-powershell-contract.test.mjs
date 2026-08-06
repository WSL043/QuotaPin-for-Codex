import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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

test("update PowerShell sources parse in Windows PowerShell 5.1", { skip: process.platform !== "win32" }, () => {
  const files = ["scripts/update.ps1", "src/runtime-trust.ps1", "src/lifecycle.ps1"]
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

test("command updater contract keeps trust, full rollback, cleanup, and one resume owner", () => {
  const updater = fs.readFileSync(path.join(root, "scripts", "update.ps1"), "utf8");
  const trust = fs.readFileSync(path.join(root, "src", "runtime-trust.ps1"), "utf8");
  for (const asset of ["QuotaPin-Windows-x64.zip"]) {
    assert.match(updater, new RegExp(asset.replaceAll(".", "\\.")), asset);
  }
  for (const member of ["QuotaPin-release.json", "QuotaPin-release.json.sha256", "SHA256SUMS", "QuotaPin.Agent.exe.sha256", "THIRD_PARTY_NOTICES.txt.sha256"]) assert.match(trust, new RegExp(member.replaceAll(".", "\\.")), member);
  assert.match(updater, /Test-QuotaPinReleaseTrustBundle/);
  assert.match(updater, /Expand-QuotaPinReleaseBundle/);
  assert.match(updater, /archive\/\$\(\$ReleaseTrust\.commit\)\.zip/);
  assert.match(updater, /New-QuotaPinRollbackSnapshot[\s\S]*\$InstallRoot/);
  assert.match(updater, /Get-QuotaPinInstallRegistrySnapshot/);
  assert.match(updater, /Restore-QuotaPinRollbackSnapshot[\s\S]*Restore-QuotaPinInstallRegistrySnapshot/);
  assert.match(updater, /Write-QuotaPinUpdateResult 'rolled-back'/);
  assert.match(updater, /Write-QuotaPinUpdateResult 'rollback-failed'/);
  assert.match(updater, /& \$InstallerPath -DeferRuntimeResume/);
  assert.match(updater, /Get-QuotaPinResumableRuntime/);
  assert.match(updater, /cleanup-warning temp-root/);
  assert.doesNotMatch(updater, /function Resume-QuotaPinTrustedRuntime/);

  assert.match(trust, /build\.context -cne 'github-release-workflow'/);
  assert.match(trust, /workflowRunId/);
  assert.match(trust, /function Resume-QuotaPinTrustedRuntime/);
  assert.match(trust, /Get-Process -Id \$ReplacementAgent\.Id[\s\S]*\.Path[\s\S]*ReplacementStartedAt[\s\S]*Stop-Process -Id \$UnreadyAgent\.Id/);
});
