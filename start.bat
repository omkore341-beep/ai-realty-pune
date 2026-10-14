@echo off
title AI Realty Starter

echo Starting PostgreSQL...
docker compose up -d

echo.
echo Installing Node dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] npm install failed. Please check the error message above.
    pause
    exit /b %errorlevel%
)

echo.
echo Starting Application...
call npm start

pause
