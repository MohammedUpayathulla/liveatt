@echo off
echo.
echo ════════════════════════════════════════════════════════════
echo Testing CAMERA and MediaMTX Connection
echo ════════════════════════════════════════════════════════════
echo.

echo [TEST 1] Checking if mediaMTX is running (port 8888)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8888' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ mediaMTX responding on port 8888' -ForegroundColor Green } catch { Write-Host '✗ mediaMTX NOT responding - start START.bat first' -ForegroundColor Red }"

echo.
echo [TEST 2] Checking if camera stream is available (cam_01)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8888/cam_01/index.m3u8' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ Stream cam_01 is available' -ForegroundColor Green } catch { Write-Host '✗ Stream cam_01 NOT available - camera may be offline' -ForegroundColor Red }"

echo.
echo [TEST 3] Checking MJPEG frame (direct from mediaMTX)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8888/cam_01/index.m3u8/request.jpg' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ MJPEG frame received (' $r.RawContentLength ' bytes)' -ForegroundColor Green } catch { Write-Host '✗ MJPEG frame failed - camera not streaming' -ForegroundColor Red }"

echo.
echo [TEST 4] Checking Backend (port 5000)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/health' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ Backend responding on port 5000' -ForegroundColor Green } catch { Write-Host '✗ Backend NOT responding - start START.bat first' -ForegroundColor Red }"

echo.
echo [TEST 5] Checking Backend stream proxy (should fail if no auth)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:5000/api/cameras/1/stream' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ Backend stream proxy working' -ForegroundColor Green } catch { if ($_.Exception.Response.StatusCode -eq 'Unauthorized' -or $_.Exception.Response.StatusCode -eq 401) { Write-Host '✓ Backend proxy reachable (returns 401 without auth - expected)' -ForegroundColor Yellow } else { Write-Host '✗ Backend proxy error: ' $_.Exception.Message -ForegroundColor Red } }"

echo.
echo [TEST 6] Checking Frontend (port 3000)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/LiveAttendance/' -TimeoutSec 2 -ErrorAction Stop; Write-Host '✓ Frontend responding on port 3000' -ForegroundColor Green } catch { Write-Host '✗ Frontend NOT responding - start START.bat first' -ForegroundColor Red }"

echo.
echo ════════════════════════════════════════════════════════════
echo SUMMARY
echo ════════════════════════════════════════════════════════════
echo.
echo If tests 1-3 FAIL:
echo   - Camera is OFFLINE or not connected
echo   - Check: rtsp://admin:Admin@123@172.16.0.150:554/ch01/1
echo   - Verify camera IP is correct and accessible
echo.
echo If test 4 FAILS:
echo   - Backend not running
echo   - Run: START.bat
echo.
echo If test 5 shows error:
echo   - Backend proxy working but needs authentication
echo   - Login first then test in browser
echo.
echo If test 6 FAILS:
echo   - Frontend not running
echo   - Run: START.bat
echo.
pause
