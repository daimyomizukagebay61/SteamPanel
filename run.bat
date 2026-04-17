@echo off
cd /d "%~dp0"
title SteamPanel

rem === Check Python ===
python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install Python 3.10+ from https://python.org
    goto :keepopen
)

rem === Virtual environment ===
rem If venv python.exe can't run, it means venv is stale (project was moved). Recreate it.
if exist "venv\Scripts\python.exe" (
    venv\Scripts\python.exe --version >nul 2>&1
    if errorlevel 1 (
        echo Stale venv detected. Recreating...
        rmdir /s /q venv
    )
)

if not exist "venv\Scripts\activate.bat" (
    echo Creating virtual environment...
    python -m venv venv
    if errorlevel 1 goto :err_venv
    echo Virtual environment created.
)

rem === Dependencies ===
venv\Scripts\pip.exe show fastapi >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    venv\Scripts\pip.exe install -r requirements.txt
    if errorlevel 1 goto :err_deps
    echo Dependencies installed.
) else (
    echo Dependencies OK.
)

:launch
cls

rem === Check built frontend ===
if not exist "app\static\assets\" (
    echo.
    echo [!] Frontend is not built. Static assets not found in app\static\assets\
    echo     The browser will show a blank white page without them.
    echo.
    echo     To fix: install Node.js from https://nodejs.org, then run:
    echo       cd frontend
    echo       npm install
    echo       npm run build
    echo.
    pause
    goto :keepopen
)

echo.

venv\Scripts\python.exe main.py

echo.
echo SteamPanel stopped.
goto :keepopen

:err_venv
echo Failed to create virtual environment.
echo Make sure Python 3.14+ is installed: https://python.org
goto :keepopen

:err_deps
echo Dependency installation failed. See errors above.
goto :keepopen

:keepopen
echo.
pause
