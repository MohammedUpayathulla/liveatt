@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

cls
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  Live Attendance System - FFmpeg Streaming                 ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo Current directory: %cd%
echo.

REM Check for Node.js
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found - install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

REM Check for Python
where python >nul 2>&1
if errorlevel 1 (
  echo ERROR: python not found - install Python from https://www.python.org/
  pause
  exit /b 1
)

REM Check for FFmpeg
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo WARNING: ffmpeg not found - streaming may not work
  echo Install from: https://ffmpeg.org/download.html
  echo.
)

REM Kill any existing services
echo Stopping old services...
taskkill /F /IM node.exe 2>nul
taskkill /F /IM python.exe 2>nul
taskkill /F /IM mediamtx.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo ════════════════════════════════════════════════════════════
echo [0/4] Starting MediaMTX (WebRTC/RTSP bridge, port 8889)
echo ════════════════════════════════════════════════════════════
if exist "mediamtx.exe" (
  start "MediaMTX" /B cmd /c "mediamtx.exe mediamtx.yml >mediamtx.log 2>&1"
  timeout /t 3 /nobreak >nul
  echo ✓ MediaMTX started (check mediamtx.log for errors)
) else (
  echo WARNING: mediamtx.exe not found in current directory
  echo Download from: https://github.com/bluenviron/mediamtx/releases
  echo.
)

echo.
echo ════════════════════════════════════════════════════════════
echo [1/4] Starting Backend (port 5005)
echo ════════════════════════════════════════════════════════════
cd "Backend 3\Backend"
if not exist "package.json" (
  echo ERROR: Backend package.json not found
  cd ..\..
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing Backend dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed
    cd ..\..
    pause
    exit /b 1
  )
)
echo Starting npm server...
start "Backend" /B cmd /c "npm start >backend.log 2>&1"
cd ..\..
timeout /t 5 /nobreak >nul
echo ✓ Backend started (check Backend 3\Backend\backend.log for errors)

echo.
echo ════════════════════════════════════════════════════════════
echo [2/4] Starting Frontend (port 3000)
echo ════════════════════════════════════════════════════════════
cd "frontend 3\frontend"
if not exist "package.json" (
  echo ERROR: Frontend package.json not found
  cd ..\..
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Installing Frontend dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed
    cd ..\..
    pause
    exit /b 1
  )
)
echo Starting Vite dev server...
start "Frontend" /B cmd /c "npm run dev >frontend.log 2>&1"
cd ..\..
timeout /t 5 /nobreak >nul
echo ✓ Frontend started (check frontend 3\frontend\frontend.log for errors)

echo.
echo ════════════════════════════════════════════════════════════
echo [3/4] Starting Python Services
echo ════════════════════════════════════════════════════════════
cd "python 4\python\multiangle"

if exist "pi_server.py" (
  echo Starting Python Server...
  start "Python-Server" /B cmd /c "set PYTHONIOENCODING=utf-8 & python -u pi_server.py >pi_server.log 2>&1"
  timeout /t 5 /nobreak >nul
  echo ✓ Python Server started
) else (
  echo WARNING: pi_server.py not found
)

if exist "pi_recognize.py" (
  echo Starting Face Recognition...
  start "Python-FaceReg" /B cmd /c "set PYTHONIOENCODING=utf-8 & python -u pi_recognize.py >pi_recognize.log 2>&1"
  timeout /t 2 /nobreak >nul
  echo ✓ Face Recognition started
) else (
  echo WARNING: pi_recognize.py not found
)

cd ..\..\..

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  All Services Started!                                     ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo SERVICES RUNNING:
echo   0. MediaMTX (port 8889 WebRTC, 8554 RTSP) - Stream bridge
echo   1. Backend (port 5005) - Node.js API
echo   2. Frontend (port 3000) - React UI (HTTPS)
echo   3. Python Server (port 5003) - API
echo   4. Face Recognition - Detection
echo.
echo LOGS:
echo   - MediaMTX: mediamtx.log
echo   - Backend: Backend 3\Backend\backend.log
echo   - Frontend: frontend 3\frontend\frontend.log
echo   - Python Server: python 4\python\multiangle\pi_server.log
echo   - Face Recognition: python 4\python\multiangle\pi_recognize.log
echo.
echo NEXT: Open browser at https://172.16.1.157:3000/LiveAttendance/
echo.
timeout /t 3 /nobreak >nul
start https://172.16.1.157:3000/LiveAttendance/

echo.
echo Waiting for services to initialize (20 seconds)...
timeout /t 20 /nobreak >nul

echo.
echo ════════════════════════════════════════════════════════════
echo QUICK TEST
echo ════════════════════════════════════════════════════════════
echo.
echo Checking MediaMTX...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:1984/v3/paths/list' -TimeoutSec 2 -UseBasicParsing | Out-Null; Write-Host '✓ MediaMTX responding' -ForegroundColor Green } catch { Write-Host '✗ MediaMTX not ready yet - check mediamtx.log' -ForegroundColor Yellow }"

echo.
echo Checking Backend...
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:5005/health' -TimeoutSec 2 -UseBasicParsing | Out-Null; Write-Host '✓ Backend responding' -ForegroundColor Green } catch { Write-Host '✗ Backend not ready yet (will start in a few seconds)' -ForegroundColor Yellow }"

echo.
echo Checking Frontend...
powershell -NoProfile -Command "[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }; try { Invoke-WebRequest -Uri 'https://127.0.0.1:3000/LiveAttendance/' -TimeoutSec 2 -UseBasicParsing | Out-Null; Write-Host '✓ Frontend responding (HTTPS)' -ForegroundColor Green } catch { Write-Host '✗ Frontend not ready yet (will start in a few seconds)' -ForegroundColor Yellow }"

echo.
echo ════════════════════════════════════════════════════════════
echo Done! All services are starting. Browser should open shortly.
echo If not, manually open: https://172.16.1.157:3000/LiveAttendance/
echo ════════════════════════════════════════════════════════════
echo.
pause
