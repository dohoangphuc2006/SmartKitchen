@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONPATH="
set "PYTHONHOME="
set "SK_PORT=%~1"
if not defined SK_PORT set "SK_PORT=8000"
if not exist "%~dp0.venv\Scripts\python.exe" (
    echo LỖI: Chưa có .venv. Hãy chạy setup_env.ps1 theo README.md.
    pause
    exit /b 2
)
echo ANH / WEBCAM - THU NGHIEM, DANG PHAT TRIEN. Kiem tra va xac nhan nguyen lieu.
"%~dp0.venv\Scripts\python.exe" -B -s -X utf8 "%~dp0app\run_app.py" --profile recipe --with-yolo --port "%SK_PORT%"
set "SK_RESULT=%ERRORLEVEL%"
if not "%SK_RESULT%"=="0" pause
exit /b %SK_RESULT%
