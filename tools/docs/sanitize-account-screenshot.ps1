param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [ValidateLength(1, 12)]
    [string]$Alias
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$inputFile = [IO.Path]::GetFullPath($InputPath)
$outputFile = [IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $inputFile -PathType Leaf)) {
    throw "Screenshot not found: $inputFile"
}

$source = [Drawing.Bitmap]::FromFile($inputFile)
try {
    if ($source.Width -lt 900 -or $source.Height -lt 600) {
        throw "Expected a full Codex screenshot; found $($source.Width)x$($source.Height)."
    }

    $canvas = New-Object Drawing.Bitmap($source.Width, $source.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.DrawImageUnscaled($source, 0, 0)
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit

            # Account identity occupies this stable area in the documented desktop captures.
            # The quota and help button sit to its right and are intentionally untouched.
            $identityTop = $source.Height - 44
            $identityRect = New-Object Drawing.Rectangle(14, $identityTop, 132, 30)
            $background = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 3, 3, 3))
            try { $graphics.FillRectangle($background, $identityRect) } finally { $background.Dispose() }

            $avatarX = 20
            $avatarY = $source.Height - 39
            $avatarSize = 18
            $avatarBrush = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 72, 72, 72))
            $avatarPen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(255, 112, 112, 112), 1)
            try {
                $graphics.FillEllipse($avatarBrush, $avatarX, $avatarY, $avatarSize, $avatarSize)
                $graphics.DrawEllipse($avatarPen, $avatarX, $avatarY, $avatarSize, $avatarSize)
            }
            finally {
                $avatarBrush.Dispose()
                $avatarPen.Dispose()
            }

            $font = New-Object Drawing.Font('Segoe UI', 9.5, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Point)
            $textBrush = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 232, 232, 232))
            try { $graphics.DrawString($Alias, $font, $textBrush, 44, ($source.Height - 40)) } finally {
                $textBrush.Dispose()
                $font.Dispose()
            }
        }
        finally {
            $graphics.Dispose()
        }

        $outputDirectory = Split-Path -Parent $outputFile
        if (-not (Test-Path -LiteralPath $outputDirectory)) {
            New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
        }
        $canvas.Save($outputFile, [Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $canvas.Dispose()
    }
}
finally {
    $source.Dispose()
}

Write-Output "Sanitized account identity: $outputFile"
