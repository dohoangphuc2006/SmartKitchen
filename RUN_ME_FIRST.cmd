@echo off
setlocal
chcp 65001 >nul
set "SK_PORT=%~1"
if not defined SK_PORT set "SK_PORT=8000"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_env.ps1" -Port "%SK_PORT%"
if errorlevel 1 (
    pause
    exit /b 1
)
call "%~dp0Start_Smart_Kitchen.cmd" "%SK_PORT%"
exit /b %ERRORLEVEL%
