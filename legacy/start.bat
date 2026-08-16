@echo off
:: Run this as Administrator on the 50 Target PCs
:: It installs the screen control (RustDesk) and the remote management (WinRM)

echo [1/3] Unlocking Remote Management...
powershell -Command "Enable-PSRemoting -Force"
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f
powershell -Command "Set-NetConnectionProfile -NetworkCategory Private"

echo [2/3] Installing RustDesk via WinGet...
:: Using Windows Package Manager to install RustDesk silently
winget install --id RustDesk.RustDesk --silent --force --accept-source-agreements --accept-package-agreements

echo [3/3] Setting Remote Access Password...
:: This sets the password you will use on your Main PC to log in
if exist "C:\Program Files\RustDesk\rustdesk.exe" (
    "C:\Program Files\RustDesk\rustdesk.exe" --password "Control123!"
)

echo SETUP COMPLETE.
pause
