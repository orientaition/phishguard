@echo off
setlocal
cd /d "%~dp0.."

if exist "dist\prompt_eval_gui.exe" (
    start "" "dist\prompt_eval_gui.exe"
    exit /b 0
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    python tools\prompt_eval_gui.py
    if %errorlevel% neq 0 (
        echo.
        echo Error: Failed to run tools\prompt_eval_gui.py.
        echo Install the GUI dependency with:
        echo   python -m pip install -r tools\requirements.txt
        echo.
        pause
    )
    exit /b %errorlevel%
)

echo Error: Python or compiled standalone GUI (dist\prompt_eval_gui.exe) is required to run the evaluation tool.
pause
exit /b 1
