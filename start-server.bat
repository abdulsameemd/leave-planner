@echo off
setlocal enabledelayedexpansion

title DX Leave Server - Running on http://10.255.104.121:3001

:start
echo.
echo ========================================
echo Starting DigitalX Leave Server...
echo Port: 3001
echo IP: 10.255.104.121
echo ========================================
echo.

set PORT=3001
node server.js

echo.
echo ========================================
echo Server crashed or stopped.
echo Restarting in 5 seconds...
echo ========================================
echo.

timeout /t 5 /nobreak
goto start
