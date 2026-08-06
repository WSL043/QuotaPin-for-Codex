param(
    [Parameter(Mandatory = $true)]
    [ValidateCount(4, 4)]
    [string[]]$Sources,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 12)]
    [string]$Alias,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$resolvedSources = @($Sources | ForEach-Object {
    $path = [IO.Path]::GetFullPath($_)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Layout capture not found: $path" }
    $path
})

$canvas = New-Object Drawing.Bitmap(1210, 110, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
try {
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit
        $graphics.Clear([Drawing.Color]::FromArgb(255, 3, 3, 3))

        $framePen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(255, 34, 34, 34), 1)
        try { $graphics.DrawRectangle($framePen, 0, 0, 1209, 109) } finally { $framePen.Dispose() }

        $xPositions = @(24, 328, 645, 922)
        $identityRegions = @(
            @{ X = 28; Width = 94; AvatarX = 33; NameX = 55; AvatarAfter = $false; AccentName = $false },
            @{ X = 14; Width = 92; AvatarX = 18; NameX = 40; AvatarAfter = $false; AccentName = $false },
            @{ X = 104; Width = 91; AvatarX = 173; NameX = 110; AvatarAfter = $true; AccentName = $false },
            @{ X = 78; Width = 118; AvatarX = 174; NameX = 84; AvatarAfter = $true; AccentName = $true }
        )

        for ($index = 0; $index -lt 4; $index++) {
            $capture = [Drawing.Bitmap]::FromFile($resolvedSources[$index])
            try {
                $x = $xPositions[$index]
                $y = [Math]::Floor((110 - $capture.Height) / 2)
                $graphics.DrawImageUnscaled($capture, $x, $y)

                $region = $identityRegions[$index]
                $background = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 3, 3, 3))
                try { $graphics.FillRectangle($background, ($x + $region.X), ($y + 20), $region.Width, 30) } finally { $background.Dispose() }

                $avatarBrush = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 72, 72, 72))
                $avatarPen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(255, 112, 112, 112), 1)
                try {
                    $graphics.FillEllipse($avatarBrush, ($x + $region.AvatarX), ($y + 25), 16, 16)
                    $graphics.DrawEllipse($avatarPen, ($x + $region.AvatarX), ($y + 25), 16, 16)
                }
                finally {
                    $avatarBrush.Dispose()
                    $avatarPen.Dispose()
                }

                $font = New-Object Drawing.Font('Segoe UI', 9.5, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Point)
                $nameColor = if ($region.AccentName) { [Drawing.Color]::FromArgb(255, 255, 76, 76) } else { [Drawing.Color]::FromArgb(255, 232, 232, 232) }
                $nameBrush = New-Object Drawing.SolidBrush($nameColor)
                try { $graphics.DrawString($Alias, $font, $nameBrush, ($x + $region.NameX), ($y + 23)) } finally {
                    $nameBrush.Dispose()
                    $font.Dispose()
                }
            }
            finally {
                $capture.Dispose()
            }
        }
    }
    finally {
        $graphics.Dispose()
    }

    $outputFile = [IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = Split-Path -Parent $outputFile
    if (-not (Test-Path -LiteralPath $outputDirectory)) { New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null }
    $canvas.Save($outputFile, [Drawing.Imaging.ImageFormat]::Png)
    Write-Output "Built localized layout strip: $outputFile"
}
finally {
    $canvas.Dispose()
}
