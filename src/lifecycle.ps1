param(
    [string]$Action = '',
    [string]$InstallRootOverride = '',
    [string]$RegistryPathOverride = ''
)

$script:QuotaPinInstallRoot = if ($InstallRootOverride) { [IO.Path]::GetFullPath($InstallRootOverride).TrimEnd('\') } else { Split-Path -Parent $PSScriptRoot }
$script:QuotaPinStatePath = Join-Path $script:QuotaPinInstallRoot 'install-state.json'
$script:QuotaPinLifecyclePath = Join-Path $script:QuotaPinInstallRoot 'logs\lifecycle.json'
$script:QuotaPinRegistryPath = if ($RegistryPathOverride) { $RegistryPathOverride } else { 'HKCU:\Software\QuotaPin' }

function Rotate-QuotaPinLog([string]$Path, [long]$MaximumBytes = 524288, [int]$Generations = 2) {
    try {
        if (-not (Test-Path -LiteralPath $Path) -or (Get-Item -LiteralPath $Path).Length -lt $MaximumBytes) { return }
        for ($Index = $Generations; $Index -ge 1; $Index--) {
            $Source = if ($Index -eq 1) { $Path } else { '{0}.{1}' -f $Path, ($Index - 1) }
            $Destination = '{0}.{1}' -f $Path, $Index
            if (-not (Test-Path -LiteralPath $Source)) { continue }
            if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue }
            Move-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction SilentlyContinue
        }
    }
    catch {}
}

function Write-QuotaPinLog([string]$Path, [string]$Message) {
    try {
        $Parent = Split-Path -Parent $Path
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
        Rotate-QuotaPinLog -Path $Path
        Add-Content -LiteralPath $Path -Value ('{0:o} {1}' -f (Get-Date), ($Message -replace '[\r\n]+', ' ')) -ErrorAction SilentlyContinue
    }
    catch {}
}

function Write-QuotaPinJsonAtomic([string]$Path, $Value) {
    $Parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    $Temporary = '{0}.{1}.tmp' -f $Path, ([Guid]::NewGuid().ToString('N'))
    try {
        $Json = $Value | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($Temporary, $Json, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $Temporary -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $Temporary) { Remove-Item -LiteralPath $Temporary -Force -ErrorAction SilentlyContinue }
    }
}

function New-QuotaPinRollbackSnapshot(
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [string]$SnapshotRoot = ''
) {
    $ResolvedTargets = @()
    foreach ($Path in $Paths) {
        if (-not $Path) { continue }
        $Resolved = [IO.Path]::GetFullPath($Path).TrimEnd('\')
        $ResolvedVolumeRoot = [IO.Path]::GetPathRoot($Resolved).TrimEnd('\')
        if (-not $Resolved -or $Resolved.Equals($ResolvedVolumeRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'A rollback snapshot cannot manage a filesystem root.'
        }
        if ($ResolvedTargets | Where-Object { $_.Equals($Resolved, [StringComparison]::OrdinalIgnoreCase) }) { continue }
        $ResolvedTargets += $Resolved
    }
    if (-not $ResolvedTargets.Count) { throw 'A rollback snapshot requires at least one target path.' }
    for ($LeftIndex = 0; $LeftIndex -lt $ResolvedTargets.Count; $LeftIndex++) {
        for ($RightIndex = $LeftIndex + 1; $RightIndex -lt $ResolvedTargets.Count; $RightIndex++) {
            $Left = $ResolvedTargets[$LeftIndex]
            $Right = $ResolvedTargets[$RightIndex]
            if ($Left.StartsWith($Right + '\', [StringComparison]::OrdinalIgnoreCase) -or
                $Right.StartsWith($Left + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Rollback snapshot target paths must not overlap.'
            }
        }
    }

    if (-not $SnapshotRoot) {
        $SnapshotRoot = Join-Path ([IO.Path]::GetTempPath()) ('QuotaPin-rollback-' + [Guid]::NewGuid().ToString('N'))
    }
    $ResolvedSnapshotRoot = [IO.Path]::GetFullPath($SnapshotRoot).TrimEnd('\')
    foreach ($Target in $ResolvedTargets) {
        if ($ResolvedSnapshotRoot.Equals($Target, [StringComparison]::OrdinalIgnoreCase) -or
            $ResolvedSnapshotRoot.StartsWith($Target + '\', [StringComparison]::OrdinalIgnoreCase) -or
            $Target.StartsWith($ResolvedSnapshotRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'The rollback snapshot must not overlap a managed target path.'
        }
    }

    New-Item -ItemType Directory -Path $ResolvedSnapshotRoot -Force | Out-Null
    $ItemsRoot = Join-Path $ResolvedSnapshotRoot 'items'
    New-Item -ItemType Directory -Path $ItemsRoot -Force | Out-Null
    $Entries = @()
    try {
        for ($Index = 0; $Index -lt $ResolvedTargets.Count; $Index++) {
            $Target = $ResolvedTargets[$Index]
            $Exists = Test-Path -LiteralPath $Target
            $Kind = 'missing'
            $StoredName = '{0:D4}' -f $Index
            $StoredPath = Join-Path $ItemsRoot $StoredName
            if ($Exists) {
                $Item = Get-Item -LiteralPath $Target -Force
                $Kind = if ($Item.PSIsContainer) { 'directory' } else { 'file' }
                if ($Item.PSIsContainer) {
                    Copy-Item -LiteralPath $Target -Destination $StoredPath -Recurse -Force
                }
                else {
                    Copy-Item -LiteralPath $Target -Destination $StoredPath -Force
                }
            }
            $Entries += [pscustomobject]@{
                target = $Target
                kind = $Kind
                storedName = $StoredName
            }
        }
        $Manifest = [ordered]@{
            schema = 1
            createdAt = [DateTimeOffset]::Now.ToString('o')
            entries = @($Entries)
        }
        Write-QuotaPinJsonAtomic -Path (Join-Path $ResolvedSnapshotRoot 'manifest.json') -Value $Manifest
        [pscustomobject]@{
            schema = 1
            root = $ResolvedSnapshotRoot
            entries = @($Entries)
        }
    }
    catch {
        Remove-Item -LiteralPath $ResolvedSnapshotRoot -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Restore-QuotaPinRollbackSnapshot(
    [Parameter(Mandatory = $true)]$Snapshot
) {
    if ([int]$Snapshot.schema -ne 1 -or -not $Snapshot.root -or -not $Snapshot.entries) {
        throw 'The rollback snapshot is invalid.'
    }
    $ResolvedSnapshotRoot = [IO.Path]::GetFullPath([string]$Snapshot.root).TrimEnd('\')
    $ItemsRoot = Join-Path $ResolvedSnapshotRoot 'items'
    if (-not (Test-Path -LiteralPath (Join-Path $ResolvedSnapshotRoot 'manifest.json') -PathType Leaf)) {
        throw 'The rollback snapshot manifest is missing.'
    }

    $Failures = @()
    foreach ($Entry in @($Snapshot.entries)) {
        try {
            $Target = [IO.Path]::GetFullPath([string]$Entry.target).TrimEnd('\')
            $Kind = [string]$Entry.kind
            if ($Kind -notin @('missing', 'file', 'directory') -or [string]$Entry.storedName -notmatch '^\d{4}$') {
                throw 'The rollback snapshot entry is invalid.'
            }
            $StoredPath = Join-Path $ItemsRoot ([string]$Entry.storedName)
            if ($Kind -ne 'missing' -and -not (Test-Path -LiteralPath $StoredPath)) {
                throw "Rollback content is missing for $Target"
            }
            if (Test-Path -LiteralPath $Target) {
                $Existing = Get-Item -LiteralPath $Target -Force
                Remove-Item -LiteralPath $Target -Recurse:$Existing.PSIsContainer -Force
            }
            if ($Kind -ne 'missing') {
                $Parent = Split-Path -Parent $Target
                if ($Parent) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
                if ($Kind -eq 'directory') {
                    Copy-Item -LiteralPath $StoredPath -Destination $Target -Recurse -Force
                }
                else {
                    Copy-Item -LiteralPath $StoredPath -Destination $Target -Force
                }
            }
        }
        catch {
            $Failures += $_.Exception
        }
    }
    if ($Failures.Count) {
        throw [AggregateException]::new('QuotaPin could not completely restore the previous installation.', $Failures)
    }
}

function Remove-QuotaPinRollbackSnapshot(
    [Parameter(Mandatory = $true)]$Snapshot
) {
    try {
        if (-not $Snapshot.root) { return $true }
        $ResolvedSnapshotRoot = [IO.Path]::GetFullPath([string]$Snapshot.root).TrimEnd('\')
        if (Test-Path -LiteralPath $ResolvedSnapshotRoot) {
            Remove-Item -LiteralPath $ResolvedSnapshotRoot -Recurse -Force
        }
        return $true
    }
    catch {
        return $false
    }
}

function Get-QuotaPinInstallOwner {
    try {
        $Owner = [string](Get-ItemPropertyValue -LiteralPath $script:QuotaPinRegistryPath -Name 'InstallOwner' -ErrorAction Stop)
        if ($Owner -in @('setup', 'command')) { return $Owner }
    }
    catch {}
    try {
        if (Test-Path -LiteralPath $script:QuotaPinStatePath) {
            $State = Get-Content -Raw -LiteralPath $script:QuotaPinStatePath | ConvertFrom-Json
            $Owner = [string]$State.owner
            if ($Owner -in @('setup', 'command')) { return $Owner }
        }
    }
    catch {}
    $null
}

function Set-QuotaPinInstallOwner(
    [ValidateSet('setup', 'command')][string]$Owner,
    [string]$Version,
    [object]$Origin = $null,
    [object]$Preferences = $null
) {
    New-Item -Path $script:QuotaPinRegistryPath -Force | Out-Null
    New-ItemProperty -LiteralPath $script:QuotaPinRegistryPath -Name 'InstallOwner' -Value $Owner -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $script:QuotaPinRegistryPath -Name 'InstallSchema' -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -LiteralPath $script:QuotaPinRegistryPath -Name 'InstallVersion' -Value $Version -PropertyType String -Force | Out-Null
    $InstallState = [ordered]@{
        schema = 1
        owner = $Owner
        version = $Version
        writtenAt = [DateTimeOffset]::Now.ToString('o')
    }
    if ($Origin) { $InstallState.origin = $Origin }
    if ($Preferences) { $InstallState.preferences = $Preferences }
    Write-QuotaPinJsonAtomic -Path $script:QuotaPinStatePath -Value $InstallState
}

function Clear-QuotaPinInstallOwner([string]$ExpectedOwner) {
    $Owner = Get-QuotaPinInstallOwner
    if ($ExpectedOwner -and $Owner -and -not $Owner.Equals($ExpectedOwner, [StringComparison]::OrdinalIgnoreCase)) { return $false }
    Remove-Item -LiteralPath $script:QuotaPinRegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    return $true
}

function Get-QuotaPinInstallRegistrySnapshot {
    if (-not (Test-Path -LiteralPath $script:QuotaPinRegistryPath)) {
        return [pscustomobject]@{ schema = 1; path = $script:QuotaPinRegistryPath; existed = $false; values = @() }
    }
    $Key = Get-Item -LiteralPath $script:QuotaPinRegistryPath -ErrorAction Stop
    $Values = @()
    foreach ($Name in @($Key.GetValueNames())) {
        $Values += [pscustomobject]@{
            name = [string]$Name
            kind = [string]$Key.GetValueKind($Name)
            value = $Key.GetValue($Name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
    }
    [pscustomobject]@{
        schema = 1
        path = $script:QuotaPinRegistryPath
        existed = $true
        values = @($Values)
    }
}

function Restore-QuotaPinInstallRegistrySnapshot(
    [Parameter(Mandatory = $true)]$Snapshot
) {
    if ([int]$Snapshot.schema -ne 1 -or
        -not [string]::Equals([string]$Snapshot.path, $script:QuotaPinRegistryPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The install registry snapshot is invalid.'
    }
    Remove-Item -LiteralPath $script:QuotaPinRegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    if (-not [bool]$Snapshot.existed) { return }
    $null = New-Item -Path $script:QuotaPinRegistryPath -Force
    foreach ($Entry in @($Snapshot.values)) {
        $PropertyType = switch ([string]$Entry.kind) {
            'String' { 'String' }
            'ExpandString' { 'ExpandString' }
            'Binary' { 'Binary' }
            'DWord' { 'DWord' }
            'MultiString' { 'MultiString' }
            'QWord' { 'QWord' }
            'None' { 'Binary' }
            default { throw 'The install registry snapshot contains an unsupported value kind.' }
        }
        New-ItemProperty -LiteralPath $script:QuotaPinRegistryPath -Name ([string]$Entry.name) -Value $Entry.value -PropertyType $PropertyType -Force | Out-Null
    }
}

function Write-QuotaPinLifecycleState(
    [ValidateSet('starting', 'attached', 'quota-ready', 'degraded', 'stopped')][string]$State,
    [int]$CodexPid = 0,
    [int]$AgentPid = 0,
    [int]$Port = 0,
    [int]$Attempt = 0,
    [string]$Generation = '',
    [string]$Reason = ''
) {
    $Value = [ordered]@{
        schema = 1
        state = $State
        writtenAt = [DateTimeOffset]::Now.ToString('o')
    }
    if ($CodexPid -gt 0) { $Value.codexPid = $CodexPid }
    if ($AgentPid -gt 0) { $Value.agentPid = $AgentPid }
    if ($Port -gt 0) { $Value.port = $Port }
    if ($Attempt -gt 0) { $Value.attempt = $Attempt }
    if ($Generation) { $Value.generation = $Generation }
    $SafeReason = ($Reason -replace '[\r\n]+', ' ').Trim()
    if ($SafeReason) { $Value.reason = $SafeReason.Substring(0, [Math]::Min(160, $SafeReason.Length)) }
    Write-QuotaPinJsonAtomic -Path $script:QuotaPinLifecyclePath -Value $Value
}

function Test-QuotaPinOwnedShortcut([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    try {
        $Shell = New-Object -ComObject WScript.Shell
        $Shortcut = $Shell.CreateShortcut($Path)
        $Fingerprint = '{0}`n{1}`n{2}' -f $Shortcut.TargetPath, $Shortcut.Arguments, $Shortcut.Description
        return (
            $Fingerprint.IndexOf('\QuotaPin\src\launch.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0 -or
            $Fingerprint.IndexOf('start-codex-with-dom-usage.ps1', [StringComparison]::OrdinalIgnoreCase) -ge 0
        )
    }
    catch { return $false }
}

function Remove-QuotaPinCommandArtifacts {
    $StartupRoot = [Environment]::GetFolderPath('Startup')
    $ProgramsRoot = [Environment]::GetFolderPath('Programs')
    $DesktopRoot = [Environment]::GetFolderPath('Desktop')
    $StartupShortcut = Join-Path $StartupRoot 'QuotaPin Auto Attach.lnk'
    if (Test-Path -LiteralPath $StartupShortcut) { Remove-Item -LiteralPath $StartupShortcut -Force -ErrorAction SilentlyContinue }
    foreach ($Candidate in @(
        (Join-Path $DesktopRoot 'Codex.lnk'),
        (Join-Path $DesktopRoot 'Codex with QuotaPin.lnk'),
        (Join-Path $DesktopRoot 'QuotaPin.lnk'),
        (Join-Path $DesktopRoot 'Codex Usage.lnk'),
        (Join-Path $ProgramsRoot 'Codex.lnk'),
        (Join-Path $ProgramsRoot 'Codex with QuotaPin.lnk'),
        (Join-Path (Join-Path $ProgramsRoot 'QuotaPin') 'QuotaPin.lnk')
    )) {
        if (Test-QuotaPinOwnedShortcut $Candidate) { Remove-Item -LiteralPath $Candidate -Force -ErrorAction SilentlyContinue }
    }
}

if ($MyInvocation.InvocationName -ne '.' -and $Action -eq 'PrepareSetupMigration') {
    Remove-QuotaPinCommandArtifacts
}
