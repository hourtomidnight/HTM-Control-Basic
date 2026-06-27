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

echo Starting HTM Game Clock server...
start "" /B node server.js

:: Wait a moment for the server to start
timeout /t 2 /nobreak >nul

:: Open game screen and operator screen in default browser
:: Try Microsoft Edge first, then Chrome, then default browser
set GAME_URL=http://127.0.0.1:3000/game.html
set OPERATOR_URL=http://127.0.0.1:3000/operator.html

where msedge >nul 2>&1
if %errorlevel% == 0 (
    start "" msedge --new-window --app=%GAME_URL%
    timeout /t 1 /nobreak >nul
    start "" msedge --new-window --app=%OPERATOR_URL%
    goto done
)

where chrome >nul 2>&1
if %errorlevel% == 0 (
    start "" chrome --new-window --app=%GAME_URL%
    timeout /t 1 /nobreak >nul
    start "" chrome --new-window --app=%OPERATOR_URL%
    goto done
)

:: Fallback: open in default browser (tabs, not app windows)
echo Opening in default browser...
start "" %GAME_URL%
timeout /t 1 /nobreak >nul
start "" %OPERATOR_URL%

:done
echo.
echo HTM Game Clock is running.
echo Game screen:     %GAME_URL%
echo Operator screen: %OPERATOR_URL%
echo.
echo Press any key to STOP the server and close.
pause >nul

:: Kill the server
taskkill /f /im node.exe >nul 2>&1
