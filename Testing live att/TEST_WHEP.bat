@echo off
echo.
echo Testing mediaMTX WHEP Endpoint...
echo.

REM Create a minimal SDP offer
(
echo v=0
echo o=- 0 0 IN IP4 127.0.0.1
echo s=-
echo t=0 0
echo a=group:BUNDLE 0
echo a=extmap-allow-mixed
echo a=msid-semantic: WMS
echo m=video 9 UDP/TLS/RTP/SAVPF 96
echo c=IN IP4 0.0.0.0
echo a=rtcp:9 IN IP4 0.0.0.0
echo a=ice-ufrag:test
echo a=ice-pwd:testpassword123456789
echo a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
echo a=setup:actpass
echo a=mid:0
echo a=sendrecv
echo a=rtcp-mux
echo a=rtpmap:96 H264/90000
) > offer.sdp

echo [TEST] Sending SDP offer to mediaMTX WHEP endpoint...
echo URL: http://localhost:8889/cam_01/whep
echo.

curl -v -X POST http://localhost:8889/cam_01/whep ^
  -H "Content-Type: application/sdp" ^
  --data-binary @offer.sdp

echo.
echo.
echo Response saved above. Check if it contains "v=0" (valid SDP) or RTSP URL (invalid)
echo.
del offer.sdp
pause
