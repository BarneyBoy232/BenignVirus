# This file is for your Main PC. Run in PowerShell.

# --- CONFIGURATION ---
$TargetAdmin = "NetAdmin" 
$TargetPass  = "YourPassword" 
$AppsToInstall = @("googlechrome", "rustdesk")
$RemoteControlPass = "Control123!" 

# --- CREDENTIAL SETUP ---
$SecPass = ConvertTo-SecureString $TargetPass -AsPlainText -Force
$Creds = New-Object System.Management.Automation.PSCredential($TargetAdmin, $SecPass)

# --- NETWORK SCAN ---
Write-Host "Scanning network..." -ForegroundColor Cyan
$ActiveIPs = 1..254 | ForEach-Object {
    if (Test-Connection -ComputerName "192.168.1.$_" -Count 1 -Quiet) { "192.168.1.$_" }
}

# --- DEPLOYMENT LOOP ---
foreach ($IP in $ActiveIPs) {
    Write-Host "Connecting to $IP..." -ForegroundColor White
    try {
        Invoke-Command -ComputerName $IP -Credential $Creds -ScriptBlock {
            foreach ($app in $using:AppsToInstall) {
                Write-Host "Installing $app..."
                choco install $app -y
            }
            if (Test-Path "C:\Program Files\RustDesk\rustdesk.exe") {
                & "C:\Program Files\RustDesk\rustdesk.exe" --password $using:RemoteControlPass
            }
        } -ErrorAction Stop
        Write-Host "SUCCESS: $IP is ready." -ForegroundColor Green
    } catch {
        Write-Host "FAILED: $IP" -ForegroundColor Gray
    }
}
