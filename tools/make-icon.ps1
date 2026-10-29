# Renders the LeakCode logo (a "C" with a droplet on a rounded square) to
# PNGs, then packs them into build\icon.ico.
#   powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1

Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'build\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
    $s = $size / 32.0
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-RoundedRect (0.5 * $s) (0.5 * $s) (31 * $s) (31 * $s) (8 * $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $size, $size), ([System.Drawing.Color]::FromArgb(255, 154, 168, 255)), ([System.Drawing.Color]::FromArgb(255, 91, 108, 240))
    $g.FillPath($brush, $rect)

    # the "C": an arc open to the right
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(1.6, 3.2 * $s))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $g.DrawArc($pen, 6.3 * $s, 8.8 * $s, 14.4 * $s, 14.4 * $s, 38, 284)

    # the droplet: a circle plus the two tangent lines from its tip
    $drop = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cx = 24.2 * $s; $cy = 21.4 * $s; $r = 2.6 * $s; $tip = 6.0 * $s
    $alpha = [Math]::Asin($r / $tip) * 180 / [Math]::PI
    $start = -$alpha
    $rad = $start * [Math]::PI / 180
    $drop.AddLine($cx, $cy - $tip, $cx + $r * [Math]::Cos($rad), $cy + $r * [Math]::Sin($rad))
    $drop.AddArc($cx - $r, $cy - $r, 2 * $r, 2 * $r, $start, 180 + 2 * $alpha)
    $drop.CloseFigure()
    $g.FillPath([System.Drawing.Brushes]::White, $drop)

    $g.Dispose()
    $bmp.Save((Join-Path $out "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

node (Join-Path $PSScriptRoot 'make-ico.js') $out (Join-Path $root 'build\icon.ico')
