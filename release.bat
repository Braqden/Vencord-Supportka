@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  supportka release
echo  Steps: build, install, commit, push
echo  GitHub Actions will then build and publish the release,
echo  and all users will receive it via the Vencord Updater.
echo ============================================================
echo.

set /p "TAG=Enter version tag (e.g. v2.0.2): "
if "%TAG%"=="" (
    echo No tag entered, aborting.
    pause
    exit /b 1
)

echo.
echo [1/6] Syncing plugin source to the build fork...
if not exist "G:\плагин\src\plugins\supportka" mkdir "G:\плагин\src\plugins\supportka"
xcopy /e /y /q "src\plugins\supportka" "G:\плагин\src\plugins\supportka" >nul

echo [2/6] Building Vencord standalone (this may take a minute)...
pushd "G:\плагин"
set "VENCORD_REMOTE=Braqden/Vencord-Supportka"
set "VENCORD_HASH=%TAG%"
call pnpm.cmd buildStandalone
if errorlevel 1 (
    popd
    echo.
    echo Build FAILED. Fix the errors and run again.
    pause
    exit /b 1
)
popd

echo [3/6] Creating ZIP archive for manual install...
set "STAGE=%TEMP%\supportka-%TAG%"
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%\dist" >nul
copy /y "G:\плагин\dist\renderer.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\renderer.css" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\preload.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\patcher.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\vencordDesktopMain.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\vencordDesktopPreload.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.js" "%STAGE%\dist\" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.css" "%STAGE%\dist\" >nul
copy /y "drop-in.bat" "%STAGE%\" >nul
copy /y "drop-in.ps1" "%STAGE%\" >nul
if exist "G:\плагин\dist\supportka-%TAG%.zip" del "G:\плагин\dist\supportka-%TAG%.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath 'G:\плагин\dist\supportka-%TAG%.zip' -Force"
rmdir /s /q "%STAGE%"

echo [4/6] Installing to local Vencord\dist (your client)...
copy /y "G:\плагин\dist\renderer.js" "Vencord\dist\renderer.js" >nul
copy /y "G:\плагин\dist\renderer.css" "Vencord\dist\renderer.css" >nul
copy /y "G:\плагин\dist\preload.js" "Vencord\dist\preload.js" >nul
copy /y "G:\плагин\dist\patcher.js" "Vencord\dist\patcher.js" >nul
copy /y "G:\плагин\dist\vencordDesktopMain.js" "Vencord\dist\vencordDesktopMain.js" >nul
copy /y "G:\плагин\dist\vencordDesktopPreload.js" "Vencord\dist\vencordDesktopPreload.js" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.js" "Vencord\dist\vencordDesktopRenderer.js" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.css" "Vencord\dist\vencordDesktopRenderer.css" >nul

echo [5/6] Updating tracked dist for manual installs...
copy /y "G:\плагин\dist\renderer.js" "dist\renderer.js" >nul
copy /y "G:\плагин\dist\renderer.css" "dist\renderer.css" >nul
copy /y "G:\плагин\dist\preload.js" "dist\preload.js" >nul
copy /y "G:\плагин\dist\patcher.js" "dist\patcher.js" >nul
copy /y "G:\плагин\dist\vencordDesktopMain.js" "dist\vencordDesktopMain.js" >nul
copy /y "G:\плагин\dist\vencordDesktopPreload.js" "dist\vencordDesktopPreload.js" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.js" "dist\vencordDesktopRenderer.js" >nul
copy /y "G:\плагин\dist\vencordDesktopRenderer.css" "dist\vencordDesktopRenderer.css" >nul
copy /y "G:\плагин\dist\supportka-%TAG%.zip" "dist\supportka-%TAG%.zip" >nul

echo [6/6] Committing, tagging and pushing...
git add -A
git commit -m "%TAG%"
git tag "%TAG%"
git push origin main
git push origin "%TAG%"

echo.
echo Done!
echo  - Restart Discord to apply the new version locally.
echo  - GitHub Actions is building the release now.
echo  - Users get the update via the Vencord Updater notification.
echo    (Settings / Vencord / Plugins / supportka / Updater tab)
echo  - Manual install: download the ZIP from the release and run drop-in.bat
echo.
pause
