@echo off
setlocal EnableDelayedExpansion
title HTM Game Clock — Launcher

set BRANCH=claude/modern-pc-app-conversion-pgpyy2
set REPO=https://github.com/hourtomidnight/HTM-Control-Basic
set OPERATOR_URL=http://127.0.0.1:4000/operator.html

:MAIN_MENU
cls
echo.
echo  ============================================================
echo   HTM GAME CLOCK
echo  ============================================================
echo.

:: ── Check Node.js ────────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js is NOT installed.
    echo.
    echo      Download it from: https://nodejs.org
    echo      Install, then re-run this menu.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo  Node.js  %NODE_VER%                          OK

:: ── Check Git ────────────────────────────────────────────────────────────────
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  Git       NOT FOUND — updates unavailable
    set GIT_OK=0
) else (
    for /f "tokens=3" %%v in ('git --version 2^>nul') do set GIT_VER=%%v
    echo  Git       %GIT_VER%                       OK
    set GIT_OK=1
)

:: ── Version check ─────────────────────────────────────────────────────────────
echo.
if "%GIT_OK%"=="1" (
    echo  Checking for updates...
    git fetch origin %BRANCH% >nul 2>&1
    if !errorlevel! neq 0 (
        echo  [!] Could not reach GitHub — running with local version.
        set UPDATE_AVAILABLE=0
    ) else (
        for /f %%h in ('git rev-parse HEAD 2^>nul') do set LOCAL_HASH=%%h
        for /f %%h in ('git rev-parse origin/%BRANCH% 2^>nul') do set REMOTE_HASH=%%h
        if "!LOCAL_HASH!"=="!REMOTE_HASH!" (
            echo  Version    Up to date  (!LOCAL_HASH:~0,7!)
            set UPDATE_AVAILABLE=0
        ) else (
            echo  Version    UPDATE AVAILABLE
            echo             Local:  !LOCAL_HASH:~0,7!
            echo             Remote: !REMOTE_HASH:~0,7!
            set UPDATE_AVAILABLE=1
        )
    )
) else (
    echo  Version    Unknown (Git not installed)
    set UPDATE_AVAILABLE=0
)

echo.
echo  ============================================================
echo.
if "%UPDATE_AVAILABLE%"=="1" (
    echo   [1]  Update ^& Launch
    echo   [2]  Launch without updating
) else (
    echo   [1]  Launch
)
echo   [3]  Update only (no launch)
echo   [4]  Exit
echo.
set /p CHOICE= Choice:

if "%UPDATE_AVAILABLE%"=="1" (
    if "%CHOICE%"=="1" goto DO_UPDATE_THEN_LAUNCH
    if "%CHOICE%"=="2" goto DO_LAUNCH
) else (
    if "%CHOICE%"=="1" goto DO_LAUNCH
)
if "%CHOICE%"=="3" goto DO_UPDATE_ONLY
if "%CHOICE%"=="4" goto EXIT
goto MAIN_MENU


:: ── Update ────────────────────────────────────────────────────────────────────
:DO_UPDATE_THEN_LAUNCH
:DO_UPDATE_ONLY
cls
echo.
echo  Updating from GitHub...
echo.
git stash >nul 2>&1
git checkout %BRANCH% >nul 2>&1
git pull origin %BRANCH%
if %errorlevel% neq 0 (
    echo.
    echo  [!] Update failed. Check your internet connection and try again.
    echo.
    pause
    goto MAIN_MENU
)
echo.
echo  Update complete.

if "%CHOICE%"=="3" (
    echo.
    pause
    goto MAIN_MENU
)
:: Fall through to launch
goto DO_LAUNCH


:: ── Launch ────────────────────────────────────────────────────────────────────
:DO_LAUNCH
cls
echo.
echo  ============================================================
echo   HTM GAME CLOCK — Starting
echo  ============================================================
echo.

:: Kill any previous server on port 4000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":4000 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /f /pid %%p >nul 2>&1
)

echo  Starting server on port 4000...
start "" /B node server.js

:: Wait for server to be ready
timeout /t 2 /nobreak >nul

:: Try to confirm server started
curl -s --max-time 3 http://127.0.0.1:4000/ >nul 2>&1
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
)

echo  Opening operator window...
echo.

where msedge >nul 2>&1
if %errorlevel% == 0 (
    start "" msedge --new-window --app=%OPERATOR_URL%
    goto RUNNING
)

where chrome >nul 2>&1
if %errorlevel% == 0 (
    start "" chrome --new-window --app=%OPERATOR_URL%
    goto RUNNING
)

:: Fallback — default browser
start "" %OPERATOR_URL%

:RUNNING
echo  HTM Game Clock is running.
echo.
echo  Operator : %OPERATOR_URL%
echo  Game     : opened automatically by the operator window
echo.
echo  ============================================================
echo   Press any key to STOP the server and exit
echo  ============================================================
pause >nul

:: Stop the server
echo.
echo  Stopping server...
taskkill /f /im node.exe >nul 2>&1
echo  Done. Goodbye.
timeout /t 1 /nobreak >nul
exit /b 0


:EXIT
exit /b 0
