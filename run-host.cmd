@echo off
REM Double-click this to start the projectBV deploy host.
REM It just runs run-host.ps1 for you (no system settings changed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-host.ps1"
echo.
echo (host stopped) — press any key to close.
pause >nul
