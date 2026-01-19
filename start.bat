@echo off
:: Run this as Administrator on the 50 Target PCs
:: It installs the screen control (RustDesk) and the remote management (WinRM)

echo [1/4] Unlocking Remote Management...
powershell -Command "Enable-PSRemoting -Force"
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f
powershell -Command "Set-NetConnectionProfile -NetworkCategory Private"

echo [2/4] Installing Package Manager...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

echo [3/4] Installing Chrome & RustDesk...
set "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
choco install googlechrome rustdesk -y

echo [4/4] Setting Remote Access Password...
:: This sets the password you will use on your Main PC to log in
if exist "C:\Program Files\RustDesk\rustdesk.exe" (
    "C:\Program Files\RustDesk\rustdesk.exe" --password "Control123!"
)

echo SETUP COMPLETE.
pause
