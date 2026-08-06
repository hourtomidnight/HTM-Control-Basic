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

:: Open ONLY the operator screen — it will launch the game screen on the correct monitor
set OPERATOR_URL=http://127.0.0.1:4000/operator.html

where msedge >nul 2>&1
if %errorlevel% == 0 (
    start "" msedge --new-window --app=%OPERATOR_URL%
    goto done
)

where chrome >nul 2>&1
if %errorlevel% == 0 (
    start "" chrome --new-window --app=%OPERATOR_URL%
    goto done
)

:: Fallback
start "" %OPERATOR_URL%

:done
echo.
echo HTM Game Clock is running.
echo Operator: %OPERATOR_URL%
echo The operator window will launch the game screen on the configured monitor.
echo.
echo Press any key to STOP the server and close.
pause >nul

taskkill /f /im node.exe >nul 2>&1
