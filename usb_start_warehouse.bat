@echo off
title Warehouse OS v2.0 - Portable USB Bootloader
cd /d %~dp0
echo ===================================================
echo [1/3] Aktiviere Python-Umgebung...
echo ===================================================
call .venv\Scripts\activate
start "Warehouse - Backend Server" cmd /k "uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 2 >nul
echo ===================================================
echo [2/3] Starte Frontend (React/Vite)...
echo ===================================================
cd frontend
start "Warehouse - Frontend UI" cmd /k "npm run dev -- --host"
timeout /t 3 >nul
echo ===================================================
echo [3/3] System ist bereit!
echo ===================================================
echo Kopiere die IP-Adresse fuer dein Handy!
ipconfig | findstr "IPv4"
echo Oeffne Dashboard auf diesem PC...
start http://localhost:5173
exit
