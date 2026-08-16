# Copy this to run-host.ps1 and paste your real HOST auth key below.
# run-host.ps1 is gitignored so your key never gets committed.
#
# Runs the projectBV deploy host on your tailnet — no Tailscale app needed.
# Serves the .\deploy folder to your fleet as http://deployhost:8080.

$hostKey = "tskey-auth-REPLACE-ME"

.\dist\projectBV-host.exe serve `
  --tsnet `
  --hostname deployhost `
  --authkey $hostKey `
  --addr :8080
