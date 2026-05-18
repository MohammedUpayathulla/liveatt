@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

cls
echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║  Live Attendance - Service Health Check                      ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

REM Test Backend
echo Testing Backend (port 5000)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/health' -TimeoutSec 3 -UseBasicParsing; Write-Host ('✓ Backend healthy' ) -ForegroundColor Green } catch { Write-Host ('✗ Backend not responding - ' + $_.Exception.Message) -ForegroundColor Red }"
echo.

REM Test Frontend
echo Testing Frontend (port 3000)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -TimeoutSec 3 -UseBasicParsing; Write-Host ('✓ Frontend healthy') -ForegroundColor Green } catch { Write-Host ('✗ Frontend not responding - ' + $_.Exception.Message) -ForegroundColor Red }"
echo.

REM Test Cameras API
echo Testing Cameras API (GET /api/cameras)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/api/cameras' -TimeoutSec 3 -UseBasicParsing; Write-Host ('✓ Cameras API responding') -ForegroundColor Green; Write-Host ('Response: ' + $r.Content.Substring(0, 100) + '...') } catch { Write-Host ('✗ Cameras API failed - ' + $_.Exception.Message) -ForegroundColor Red }"
echo.

REM Test Streaming API (start endpoint requires rtsp_url in body)
echo Testing Streaming API (POST /api/streaming/start)...
powershell -NoProfile -Command "try { $body = @{rtspUrl='rtsp://admin:Admin@123@172.16.0.150:554/ch01/1'} | ConvertTo-Json; $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/api/streaming/start' -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 3 -UseBasicParsing; Write-Host ('✓ Streaming API responding') -ForegroundColor Green } catch { Write-Host ('✗ Streaming API failed - check FFmpeg') -ForegroundColor Red }"
echo.

REM Check if FFmpeg is available
echo Checking FFmpeg...
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo ✗ FFmpeg not in PATH
  echo  Try: C:\ffmpeg\bin\ffmpeg.exe
) else (
  echo ✓ FFmpeg found in PATH
)
echo.

echo ════════════════════════════════════════════════════════════════
echo LOGS:
echo ════════════════════════════════════════════════════════════════
echo.
echo Backend:  Backend 3\Backend\backend.log
echo Frontend: frontend 3\frontend\frontend.log
echo.
echo Open Browser DevTools (F12) to see console errors
echo.
pause
