@echo off
setlocal
title supportka drop-in

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0drop-in.ps1"

echo.
pause
