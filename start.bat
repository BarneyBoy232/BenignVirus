@echo off
:: This file is for the target PCs. Run as Administrator.

echo [1/4] Enabling Remote Management...
powershell -Command "Enable-PSRemoting -Force"

echo [2/4] Allowing Remote Admin access...
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f

echo [3/4] Setting network to Private for firewall bypass...
powershell -Command "Set-NetConnectionProfile -NetworkCategory Private"

echo [4/4] Installing Chocolatey package manager...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"

echo PREP COMPLETE.
pause
