@echo off
title HTM Game Clock

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    echo.
    echo Please download and install Node.js from https://nodejs.org
    echo Then run this batch file again.
    echo.
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo Installing dependencies, please wait...
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
    echo.
)

:: Launch the app
echo Starting HTM Game Clock...
npm start
