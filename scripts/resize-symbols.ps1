param(
    [string]$ImageDir = "G:\imagex",
    [string]$OutDir = "G:\Vencord-Supportka\.symbol-resized",
    [int]$MaxDim = 300
)
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
Get-ChildItem -LiteralPath $OutDir -Filter *.png -ErrorAction SilentlyContinue | Remove-Item -Force

function Normalize([string]$s) {
    $n = $s.ToLowerInvariant()
    $n = $n -replace "ё", "е"
    $n = $n -replace "[\u2014\u2013\u2015]", " "
    $n = $n -replace "[()|/]", " "
    $n = $n -replace "\s+", " "
    return $n.Trim()
}

Get-ChildItem -LiteralPath $ImageDir -Filter *.png | ForEach-Object {
    $img = [System.Drawing.Image]::FromFile($_.FullName)
    try {
        $scale = [Math]::Min(1.0, $MaxDim / [Math]::Max($img.Width, $img.Height))
        $nw = [int][Math]::Round($img.Width * $scale)
        $nh = [int][Math]::Round($img.Height * $scale)
        $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($img, 0, 0, $nw, $nh)
        $key = Normalize $_.BaseName
        $bmp.Save((Join-Path $OutDir "$key.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose()
        $bmp.Dispose()
    } finally {
        $img.Dispose()
    }
}

$count = (Get-ChildItem -LiteralPath $OutDir -Filter *.png).Count
Write-Output "Resized $count images to $OutDir"
