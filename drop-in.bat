@echo off
setlocal

set "SRC=%~dp0dist"

set "VC=%~dp0Vencord"
if not exist "%VC%\dist\renderer.js" set "VC=%LOCALAPPDATA%\Vencord"
if not exist "%VC%\dist\renderer.js" set "VC=%APPDATA%\Vencord"
if not exist "%VC%\dist\renderer.js" (
    echo [Script] Vencord folder not found.
    echo [Script] Expected folder: %~dp0Vencord (or %LOCALAPPDATA%\Vencord)
    echo [Script] Then run this file again.
    pause
    exit /b 1
)

echo [Script] Copying renderer.js and renderer.css to "%VC%\dist"
copy /y "%SRC%\renderer.js" "%VC%\dist\renderer.js" >nul
copy /y "%SRC%\renderer.css" "%VC%\dist\renderer.css" >nul

echo.
echo [Script] DONE!
echo [Script] 1. Fully restart Discord: tray - Quit - open again.
echo [Script] 2. Settings - Vencord - Plugins: enable the "supportka" plugin.
echo [Script] 3. In plugin settings enable "Send commands" (Send commands to relay).
echo [Script] 4. Make sure "relayChannelId" matches the channel used by Brqden_.
echo.
echo [Script] To update the plugin, download the new version and run this again.
pause
