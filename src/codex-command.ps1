$SecurityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
Import-Module -Name $SecurityModule -ErrorAction SilentlyContinue

function Test-QuotaPinOpenAISignature([string]$Path) {
    foreach ($Attempt in 1..3) {
        $Signature = Get-AuthenticodeSignature -LiteralPath $Path -ErrorAction SilentlyContinue
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

function Get-QuotaPinCodexCommand {
    $ManagedRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
    if (Test-Path -LiteralPath $ManagedRoot) {
        $ManagedCandidates = @(Get-ChildItem -LiteralPath $ManagedRoot -Recurse -File -Filter 'codex.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
        foreach ($Candidate in $ManagedCandidates) {
            if ($Candidate.FullName -like '*\WindowsApps\*') { continue }
            if (Test-QuotaPinOpenAISignature $Candidate.FullName) {
                return $Candidate.FullName
            }
        }
    }

    $PathCandidates = @(Get-Command 'codex.exe' -All -ErrorAction SilentlyContinue | Where-Object {
        $_.Source -and
        $_.Source -notlike '*\WindowsApps\*' -and
        $_.Source -match '\.exe$'
    })
    foreach ($Candidate in $PathCandidates) {
        if (Test-QuotaPinOpenAISignature $Candidate.Source) {
            return $Candidate.Source
        }
    }
    throw 'Codex Desktop has not prepared its signed local command runtime yet. Open Codex once, then reinstall QuotaPin.'
}
