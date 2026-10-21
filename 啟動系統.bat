@echo off
chcp 65001 >nul
title ProFinish 終點攝影電子計時系統
echo ====================================================
echo 🏃‍♂️ 正在啟動 ProFinish 終點攝影電子計時系統...
echo ====================================================
cd /d "%~dp0"

start /b node server.js

echo.
echo 正在建立外網安全通道 (手機免同一 Wi-Fi，4G/5G 隨時可開)...
echo ====================================================
cloudflared.exe tunnel --url http://localhost:8080
pause
