@echo off
cd /d "%~dp0"
title SteamPanel Updater
chcp 65001 >nul

if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe update.py
    goto :end
)

python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] Python not found.
    echo     Run run.bat first to set up the environment,
    echo     or install Python from https://python.org
    goto :end
)

python update.py

:end
echo.
pause
