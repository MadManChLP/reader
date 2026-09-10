@echo off
setlocal

echo ========================================
echo   Reader Installer Build Script
echo ========================================
echo.

:: Prompt for version number
set /p "APP_VERSION=Enter version number (e.g. 1.6.18): "
if "%APP_VERSION%"=="" (
    echo No version entered. Using default from .iss file.
    set "VERSION_DEFINE="
) else (
    set "VERSION_DEFINE=/DMyAppVersion=%APP_VERSION%"
)
echo.

:: Check for Inno Setup
set "ISCC="

:: Check common installation paths
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
)
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" (
    set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
)

:: Check if ISCC was found
if "%ISCC%"=="" (
    echo ERROR: Inno Setup 6 not found!
    echo.
    echo Please install Inno Setup 6 from:
    echo   https://jrsoftware.org/isdl.php
    echo.
    echo Or install via winget:
    echo   winget install JRSoftware.InnoSetup
    echo.
    pause
    exit /b 1
)

echo Found Inno Setup at: %ISCC%
echo.

:: Check if reader.exe exists
if not exist "Z:\Programiren\git\reader\src-tauri\target\release\reader.exe" (
    echo ERROR: reader.exe not found!
    echo.
    echo Please build the Tauri app first:
    echo   powershell -ExecutionPolicy Bypass -File build-tauri.ps1
    echo.
    pause
    exit /b 1
)

echo Building installer...
echo.

:: Change to the installer directory so all relative paths resolve correctly
cd /d "%~dp0"

:: Create output directory
if not exist "%~dp0output" mkdir "%~dp0output"

:: Run Inno Setup Compiler
"%ISCC%" /O"%~dp0output" %VERSION_DEFINE% "%~dp0reader-setup.iss"

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Installer build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Installer built successfully!
echo ========================================
echo.
if "%APP_VERSION%"=="" (
    echo Output: %~dp0output\
) else (
    echo Output: %~dp0output\Reader-%APP_VERSION%-Setup.exe
)
echo.

pause
