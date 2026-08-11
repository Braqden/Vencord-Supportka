# Vencord-Supportka: автоматическая установка у друга
# Требует: Git, Node.js LTS, pnpm (pnpm поставится автоматически)
# Запуск: двойной клик install.bat

$ErrorActionPreference = "Stop"

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Fail($message) {
    Write-Host $message -ForegroundColor Red
    Read-Host "Нажми Enter, чтобы закрыть"
    exit 1
}

if (-not (Test-Command git)) { Fail "ОШИБКА: Git не установлен. Скачай с https://git-scm.com/download/win" }
if (-not (Test-Command node)) { Fail "ОШИБКА: Node.js не установлен. Скачай LTS с https://nodejs.org" }
if (-not (Test-Command pnpm)) {
    Write-Host "pnpm не найден. Устанавливаю через npm..."
    npm install -g pnpm
    if ($LASTEXITCODE -ne 0) { Fail "Не удалось установить pnpm" }
}

$repoDir = $PSScriptRoot
$vencordDir = Join-Path $repoDir "Vencord"
$pluginDir = Join-Path $vencordDir "src\plugins\supportka"
$pluginSource = Join-Path $repoDir "src\plugins\supportka"

Write-Host "Папка Vencord: $vencordDir" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $vencordDir "package.json"))) {
    Write-Host "Клонирую Vencord..."
    git clone --depth 1 https://github.com/Vendicated/Vencord.git $vencordDir
    if ($LASTEXITCODE -ne 0) { Fail "Не удалось склонировать Vencord" }
} else {
    Write-Host "Vencord уже есть, обновляю..."
    git -C $vencordDir pull --ff-only
    if ($LASTEXITCODE -ne 0) { Write-Host "Не удалось обновить Vencord (продолжаю)" -ForegroundColor Yellow }
}

Write-Host "Копирую плагин в Vencord..."
if (Test-Path $pluginDir) { Remove-Item -Recurse -Force $pluginDir }
Copy-Item -Recurse $pluginSource $pluginDir

Write-Host "Устанавливаю зависимости (несколько минут)..." -ForegroundColor Cyan
Push-Location $vencordDir
try {
    pnpm install --no-frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install не удался" }

    Write-Host "Собираю Vencord..."
    pnpm build
    if ($LASTEXITCODE -ne 0) { Fail "pnpm build не удался" }

    Write-Host "Устанавливаю в Discord..."
    node scripts/runInstaller.mjs -- --install -branch stable
    if ($LASTEXITCODE -ne 0) { Fail "Установка в Discord не удалась" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "ГОТОВО!" -ForegroundColor Green
Write-Host "1) Полностью перезапусти Discord: трей -> Quit -> заново открыть."
Write-Host "2) Настройки -> Vencord -> Plugins -> supportka: включи плагин."
Write-Host "3) Включи настройку «Отправлять команды»."
Write-Host "4) Убедись, что relayChannelId совпадает с каналом Brqden_."
Write-Host ""
Write-Host "Для обновления плагина просто запусти install.bat ещё раз."
Read-Host "Нажми Enter, чтобы закрыть"
