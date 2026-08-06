param([Parameter(Mandatory = $true)][string]$ResultPath)

$ErrorActionPreference = 'SilentlyContinue'
$Problems = New-Object System.Collections.Generic.List[string]
$SecurityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $SecurityModule -ErrorAction SilentlyContinue

function Test-OpenAISignature([string]$Path) {
    foreach ($Attempt in 1..3) {
        try {
            $Signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction Stop
        }
        catch {
            $Signature = $null
        }
        $Certificate = $Signature.SignerCertificate
        $Publisher = if ($Certificate) { [string]$Certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }
        $Subject = [string]$Certificate.Subject
        $OrganizationMatches = $Subject -match '(?:^|,\s*)O=(?:"OpenAI OpCo, LLC"|OpenAI OpCo\\, LLC)(?:,\s*|$)'
        if (([string]$Signature.Status -eq 'Valid') -and $Publisher -ceq 'OpenAI OpCo, LLC' -and $OrganizationMatches) {
            return $true
        }
        if ($Attempt -lt 3) { Start-Sleep -Milliseconds 300 }
    }
    $false
}

$Package = Get-AppxPackage -Name 'OpenAI.Codex'
if (-not $Package) { $Problems.Add('Codex Desktop is not installed for this Windows user.') }

$ManagedRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
$ManagedFiles = @(Get-ChildItem -LiteralPath $ManagedRoot -Recurse -File -Filter 'codex.exe' -ErrorAction SilentlyContinue)
$ManagedCodex = @($ManagedFiles | Where-Object {
    Test-OpenAISignature $_.FullName
} | Select-Object -First 1)
$PathCodex = @(Get-Command 'codex.exe' -All -ErrorAction SilentlyContinue | Where-Object {
    $_.Source -and
    $_.Source -notlike '*\WindowsApps\*' -and
    $_.Source -match '\.exe$' -and
    (Test-OpenAISignature $_.Source)
} | Select-Object -First 1)
if (-not $ManagedCodex.Count -and -not $PathCodex.Count) {
    $Problems.Add('Codex Desktop has not prepared its signed local command runtime. Open Codex once, then run setup again.')
}

if ($Problems.Count) {
    Set-Content -LiteralPath $ResultPath -Value ($Problems -join "`r`n") -Encoding ASCII
    exit 1
}

Set-Content -LiteralPath $ResultPath -Value 'ok' -Encoding ASCII
exit 0
