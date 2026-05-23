@echo off
setlocal
cd /d "%~dp0.."

where python >nul 2>nul
if %errorlevel% equ 0 (
    python tools\prompt_eval_gui.py
    exit /b %errorlevel%
)

if exist "dist\prompt_eval_gui.exe" (
    start "" "dist\prompt_eval_gui.exe"
    exit /b 0
)

echo Error: Python or compiled standalone GUI (dist\prompt_eval_gui.exe) is required to run the evaluation tool.
pause
exit /b 1
