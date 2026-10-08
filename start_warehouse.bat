@echo off
title Warehouse OS v2.0 - Bootloader
echo ===================================================
echo [1/3] Starte FastAPI Backend...
echo ===================================================
start "Warehouse - Backend" cmd /k "cd /d %~dp0 && .venv\Scripts\activate && uvicorn app.main:app --reload"

timeout /t 2 >nul

echo ===================================================
echo [2/3] Starte React Frontend...
echo ===================================================
start "Warehouse - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 3 >nul

echo ===================================================
echo [3/3] Oeffne Warehouse Dashboard im Browser...
echo ===================================================
start http://localhost:5173

echo ===================================================
echo System erfolgreich hochgefahren! Dieses Fenster schließt sich.
echo ===================================================
timeout /t 2 >nul
exit
