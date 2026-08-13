@echo off
chcp 65001 >nul
title شاطر — القاعدة المحلية
echo ==============================
echo   شاطر — القاعدة المحلية
echo   جاري تشغيل خادم البحث...
echo ==============================
where node >nul 2>nul
if errorlevel 1 (
  echo خطأ: Node.js غير مثبت على هذا الجهاز.
  echo قم بتثبيته من https://nodejs.org ثم أعد المحاولة.
  pause
  exit /b 1
)
node "%~dp0server.js"
pause
