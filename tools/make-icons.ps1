# Draws every icon the project needs, for both the web app and the extension,
# from one description so they stay the same mark.
#
#   docs\icon-*.png          PWA (192, 512, and a maskable 512 with more margin)
#   extension\icons\*.png    Chrome extension (16, 32, 48, 128)
#
# Small sizes drop the ruled lines and the ribbon: at 16px they turn to mush and
# leave the shape less legible, not more detailed.

param([string]$Root = (Split-Path -Parent $PSScriptRoot))

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$C_ENJI   = [System.Drawing.Color]::FromArgb(155, 39, 67)
$C_ENJI_D = [System.Drawing.Color]::FromArgb(59, 14, 27)
$C_PAGE   = [System.Drawing.Color]::FromArgb(250, 244, 236)
$C_STACK  = [System.Drawing.Color]::FromArgb(206, 189, 172)
$C_INK    = [System.Drawing.Color]::FromArgb(128, 32, 55)
$C_GOLD   = [System.Drawing.Color]::FromArgb(214, 168, 78)
$C_GOLD_D = [System.Drawing.Color]::FromArgb(176, 132, 52)

function New-Icon {
    param(
        [int]$Size,
        [double]$Inset,
        [string]$Path,
        [ValidateSet('full', 'simple', 'minimal')][string]$Detail = 'full'
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, $C_ENJI, $C_ENJI_D, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
    $g.FillRectangle($grad, $rect)

    $s = $Size * (1 - 2 * $Inset)
    $o = $Size * $Inset
    $P = { param($x, $y) New-Object System.Drawing.PointF(($o + $x * $s), ($o + $y * $s)) }

    $pageBrush  = New-Object System.Drawing.SolidBrush $C_PAGE
    $stackBrush = New-Object System.Drawing.SolidBrush $C_STACK
    $goldBrush  = New-Object System.Drawing.SolidBrush $C_GOLD
    $goldDark   = New-Object System.Drawing.SolidBrush $C_GOLD_D

    # A heavier outline at small sizes, or antialiasing eats it entirely.
    $penW = if ($Detail -eq 'full') { $Size * 0.017 } else { [Math]::Max($Size * 0.03, 1.4) }
    $outline = New-Object System.Drawing.Pen($C_INK, [float]$penW)
    $outline.LineJoin = 'Round'

    # Straight outer edges and a clear V at the spine: an open book dips in the
    # middle, and the silhouette has to stay angular to read as a book at all.
    $leftPage  = @((& $P 0.07 0.29), (& $P 0.50 0.385), (& $P 0.50 0.85), (& $P 0.07 0.745))
    $rightPage = @((& $P 0.93 0.29), (& $P 0.50 0.385), (& $P 0.50 0.85), (& $P 0.93 0.745))

    $shift = {
        param($pts, $dy)
        $r = @()
        foreach ($p in $pts) { $r += New-Object System.Drawing.PointF($p.X, ($p.Y + $dy)) }
        , $r
    }

    $layers = if ($Detail -eq 'full') { @(0.050, 0.032, 0.016) } else { @(0.045) }
    foreach ($d in $layers) {
        $dy = $s * $d
        $g.FillPolygon($stackBrush, [System.Drawing.PointF[]](& $shift $leftPage $dy))
        $g.FillPolygon($stackBrush, [System.Drawing.PointF[]](& $shift $rightPage $dy))
    }

    $g.FillPolygon($pageBrush, [System.Drawing.PointF[]]$leftPage)
    $g.FillPolygon($pageBrush, [System.Drawing.PointF[]]$rightPage)
    $g.DrawPolygon($outline, [System.Drawing.PointF[]]$leftPage)
    $g.DrawPolygon($outline, [System.Drawing.PointF[]]$rightPage)

    if ($Detail -eq 'full') {
        $rule = New-Object System.Drawing.Pen($C_INK, [float]($Size * 0.020))
        $rule.StartCap = 'Round'; $rule.EndCap = 'Round'
        for ($i = 0; $i -lt 4; $i++) {
            $inner = 0.455 + $i * 0.098
            $outer = $inner - 0.095
            $g.DrawLine($rule, (& $P 0.145 $outer), (& $P 0.425 $inner))
            $g.DrawLine($rule, (& $P 0.575 $inner), (& $P 0.855 $outer))
        }
    } elseif ($Detail -eq 'simple') {
        # two strokes a side is enough to say "text" without turning to mush
        $rule = New-Object System.Drawing.Pen($C_INK, [float]([Math]::Max($Size * 0.035, 1.4)))
        $rule.StartCap = 'Round'; $rule.EndCap = 'Round'
        foreach ($i in 0, 1) {
            $inner = 0.52 + $i * 0.16
            $outer = $inner - 0.095
            $g.DrawLine($rule, (& $P 0.17 $outer), (& $P 0.41 $inner))
            $g.DrawLine($rule, (& $P 0.59 $inner), (& $P 0.83 $outer))
        }
    }

    $g.DrawLine($outline, (& $P 0.50 0.385), (& $P 0.50 0.85))

    if ($Detail -eq 'full') {
        # down the spine, then bent aside where it leaves the book so it hangs
        $w = 0.028
        $g.FillPolygon($goldDark, [System.Drawing.PointF[]]@(
            (& $P (0.50 - $w) 0.42), (& $P (0.50 - $w) 0.83),
            (& $P (0.56 - $w) 0.92), (& $P (0.60 - $w) 0.975),
            (& $P 0.60 0.935),
            (& $P (0.60 + $w) 0.975), (& $P (0.56 + $w) 0.92),
            (& $P (0.50 + $w) 0.83), (& $P (0.50 + $w) 0.42)))
        $g.FillPolygon($goldBrush, [System.Drawing.PointF[]]@(
            (& $P (0.50 - $w) 0.80), (& $P (0.56 - $w) 0.90), (& $P (0.60 - $w) 0.96),
            (& $P 0.60 0.925),
            (& $P (0.60 + $w) 0.96), (& $P (0.56 + $w) 0.90), (& $P (0.50 + $w) 0.80)))
        $g.FillPolygon($goldBrush, [System.Drawing.PointF[]]@(
            (& $P (0.50 - $w) 0.42), (& $P (0.50 + $w) 0.42),
            (& $P (0.50 + $w) 0.82), (& $P (0.50 - $w) 0.82)))
    } elseif ($Detail -eq 'simple') {
        $w = 0.045
        $g.FillPolygon($goldBrush, [System.Drawing.PointF[]]@(
            (& $P (0.50 - $w) 0.40), (& $P (0.50 + $w) 0.40),
            (& $P (0.50 + $w) 0.93), (& $P 0.50 0.865), (& $P (0.50 - $w) 0.93)))
    }

    $g.Dispose()
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory $dir -Force | Out-Null }
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("  {0,-24} {1,6} bytes" -f (Split-Path $Path -Leaf), (Get-Item $Path).Length)
}

$docs = Join-Path $Root 'docs'
$ext = Join-Path $Root 'extension\icons'

Write-Output 'web app:'
New-Icon -Size 192 -Inset 0.12 -Detail full -Path (Join-Path $docs 'icon-192.png')
New-Icon -Size 512 -Inset 0.12 -Detail full -Path (Join-Path $docs 'icon-512.png')
New-Icon -Size 512 -Inset 0.21 -Detail full -Path (Join-Path $docs 'icon-maskable-512.png')

Write-Output 'extension:'
New-Icon -Size 128 -Inset 0.10 -Detail full    -Path (Join-Path $ext 'icon-128.png')
New-Icon -Size 48  -Inset 0.08 -Detail simple  -Path (Join-Path $ext 'icon-48.png')
New-Icon -Size 32  -Inset 0.06 -Detail simple  -Path (Join-Path $ext 'icon-32.png')
New-Icon -Size 16  -Inset 0.04 -Detail minimal -Path (Join-Path $ext 'icon-16.png')
