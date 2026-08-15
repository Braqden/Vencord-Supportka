# supportka drop-in installer
# Installs the supportka build into:
#   - Vencord (stock Discord injection; official + custom install paths)
#   - Vesktop and any other app that loads Vencord from <data>\sessionData\vencordFiles
# Usage: double-click drop-in.bat, or run this file directly.

$ErrorActionPreference = "SilentlyContinue"

$scriptDir = $PSScriptRoot

$standalone = @("patcher.js", "preload.js", "renderer.js", "renderer.css")
$desktop    = @("vencordDesktopMain.js", "vencordDesktopPreload.js", "vencordDesktopRenderer.js", "vencordDesktopRenderer.css")

Write-Host ""
Write-Host "=== supportka drop-in installer ===" -ForegroundColor Cyan
Write-Host ""

# ---- locate the build (source) ----
$src = $null
foreach ($candidate in @((Join-Path $scriptDir "Vencord\dist"), (Join-Path $scriptDir "dist"))) {
    if (Test-Path (Join-Path $candidate "renderer.js")) { $src = $candidate; break }
}
if (-not $src) {
    Write-Host "[FAIL] Build not found. Expected 'Vencord\dist' or 'dist' next to this script." -ForegroundColor Red
    Write-Host "       Put this script next to the supportka build and run again."
    exit 1
}
Write-Host "Build source : $src"

# ---- copy a set of files into a target folder ----
function Copy-Files {
    param([string]$dst, [string[]]$files)
    if (-not $dst) { return $false }
    if (-not (Test-Path $dst)) { return $false }
    foreach ($f in $files) {
        $from = Join-Path $src $f
        if (-not (Test-Path $from)) { continue }
        $to = Join-Path $dst $f
        $srcResolved = (Resolve-Path $from -ErrorAction SilentlyContinue).Path
        $dstResolved = (Resolve-Path $to -ErrorAction SilentlyContinue).Path
        if ($srcResolved -and $dstResolved -and $srcResolved -ieq $dstResolved) { continue }
        try {
            Copy-Item -LiteralPath $from -Destination $to -Force -ErrorAction Stop
            Write-Host "  +  $f" -ForegroundColor Green
        } catch {
            Write-Host "  !! $f  (file locked? close Discord/Vesktop and re-run)" -ForegroundColor Yellow
        }
    }
    return $true
}

$installed = @()

# ---- 1. Vencord (Discord injection) ----
Write-Host ""
Write-Host "[1] Vencord for Discord" -ForegroundColor Magenta
$vencordDirs = @(
    (Join-Path $scriptDir "Vencord"),
    (Join-Path $env:LOCALAPPDATA "Vencord"),
    (Join-Path $env:APPDATA "Vencord")
)
foreach ($base in @($env:LOCALAPPDATA, $env:APPDATA)) {
    if (-not $base) { continue }
    Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*Vencord*" } |
        ForEach-Object { $vencordDirs += $_.FullName }
}
foreach ($d in ($vencordDirs | Select-Object -Unique)) {
    $dist = Join-Path $d "dist"
    if (Test-Path (Join-Path $dist "renderer.js")) {
        if (Copy-Files $dist $standalone) { $installed += $dist }
    }
}

# ---- 2. Vesktop and other Vencord-based clients (vencordFiles) ----
Write-Host ""
Write-Host "[2] Vesktop / Vencord-based clients" -ForegroundColor Magenta
$vesktopDirs = @()
foreach ($base in @($env:APPDATA, $env:LOCALAPPDATA)) {
    if (-not $base) { continue }

    # default Vesktop data dir
    if (Test-Path (Join-Path $base "vesktop")) {
        $vesktopDirs += (Join-Path $base "vesktop\sessionData\vencordFiles")
    }

    # custom Vencord dir configured in Vesktop settings
    $settings = Join-Path $base "vesktop\settings\settings.json"
    if (Test-Path $settings) {
        $cfg = Get-Content $settings -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($cfg.vencordDir) { $vesktopDirs += $cfg.vencordDir }
    }

    # any other app folders that keep a vencordFiles dir
    Get-ChildItem $base -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*vesktop*" -or $_.Name -like "*vencord*" } |
        ForEach-Object {
            $vd = Join-Path $_.FullName "sessionData\vencordFiles"
            if (Test-Path $vd) { $vesktopDirs += $vd }
        }
}
foreach ($d in ($vesktopDirs | Select-Object -Unique)) {
    if (-not $d) { continue }
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    if (Copy-Files $d $desktop) {
        try { Set-Content -LiteralPath (Join-Path $d "package.json") -Value "{}" -Encoding ascii -ErrorAction Stop } catch {}
        $installed += $d
    }
}

# ---- running-process warning ----
$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "discord|vesktop" }
if ($running) {
    Write-Host ""
    Write-Host "[!] Discord or Vesktop is currently running." -ForegroundColor Yellow
    Write-Host "    If the script showed 'locked' errors, close the app (tray -> Quit) and run again." -ForegroundColor Yellow
}

# ---- summary ----
Write-Host ""
Write-Host "=== Result ===" -ForegroundColor Cyan
$installed = $installed | Select-Object -Unique
if ($installed.Count) {
    foreach ($i in $installed) { Write-Host "  OK   $i" -ForegroundColor Green }
    Write-Host ""
    Write-Host "Installed. Restart Discord / Vesktop."
    Write-Host "For Discord: Settings > Vencord > Plugins, enable 'supportka'."
    Write-Host "For Vesktop:  Settings > Vencord > Plugins, enable 'supportka'."
} else {
    Write-Host "Nothing patched. The script looked here:"
    Write-Host "  - $scriptDir\Vencord\dist"
    Write-Host "  - $env:LOCALAPPDATA\Vencord\dist  (Vencord installed via official installer)"
    Write-Host "  - $env:APPDATA\Vencord\dist"
    Write-Host "  - $env:APPDATA\vesktop\sessionData\vencordFiles  (Vesktop)"
    Write-Host ""
    Write-Host "Install Vencord or Vesktop first, then run this script again."
}

exit 0
