# Builds every projectBV binary into dist\.
#
# The key is a single self-contained file: the freshly built agent is copied into
# cmd\key\agent_payload\ and compiled straight into it, then the placeholder is put
# back so the repo never carries a 20 MB binary.
#
# Everything except the host is built for the windows GUI subsystem, so nothing
# flashes a console window on the device.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$config = 'internal\config\embedded-config.json'
if (-not (Test-Path $config)) {
    throw "$config is missing. Copy internal\config\embedded-config.example.json to it and fill in your keys (see README)."
}

New-Item -ItemType Directory -Force dist | Out-Null
$payload = 'cmd\key\agent_payload\projectBV.exe'
$placeholder = [System.IO.File]::ReadAllBytes($payload)

# -s -w strips the symbol table and DWARF info: smaller binaries, same behaviour.
$silent = '-H=windowsgui -s -w'

try {
    Write-Host 'building the agent...'
    go build -ldflags $silent -o dist\projectBV.exe ./cmd/agent
    if ($LASTEXITCODE -ne 0) { throw 'agent build failed' }

    Write-Host 'building the key (agent embedded)...'
    Copy-Item dist\projectBV.exe $payload -Force
    go build -ldflags $silent -o dist\projectBV-key.exe ./cmd/key
    if ($LASTEXITCODE -ne 0) { throw 'key build failed' }

    Write-Host 'building the antidote...'
    go build -ldflags $silent -o dist\projectBV-antidote.exe ./cmd/antidote
    if ($LASTEXITCODE -ne 0) { throw 'antidote build failed' }

    Write-Host 'building the host...'
    go build -ldflags '-s -w' -o dist\projectBV-host.exe ./cmd/host
    if ($LASTEXITCODE -ne 0) { throw 'host build failed' }
}
finally {
    # Always restore the placeholder, even if a build failed part way.
    [System.IO.File]::WriteAllBytes($payload, $placeholder)
}

# The key MUST carry its asInvoker manifest. Without it Windows sees an unmanifested
# exe that looks like a setup program, auto-elevates it, and a standard user is asked
# for an admin password before main() ever runs — the exact thing the installer is
# supposed to avoid by installing per-user instead.
$keyBytes = [System.IO.File]::ReadAllText('dist\projectBV-key.exe', [System.Text.Encoding]::ASCII)
if ($keyBytes -notmatch 'requestedExecutionLevel[^>]*level\s*=\s*"asInvoker"') {
    throw @'
dist\projectBV-key.exe has no asInvoker manifest — it would trigger a UAC prompt on
standard accounts. Regenerate the resource file and build again:

  go run github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest -64 `
    -o cmd/key/resource_windows_amd64.syso cmd/key/versioninfo.json
'@
}

# Record what was just built, so the dashboard publishes the exact version the
# binary reports. A hand-typed version that doesn't match the binary leaves the
# fleet page saying "0 of N devices updated" for ever.
$version = (Select-String -Path 'internal\config\config.go' -Pattern 'const Version = "([^"]+)"').Matches[0].Groups[1].Value
# url/sha256 stay empty here: a local build isn't published anywhere the devices
# can download from. The build-key workflow fills those in when it publishes one,
# and the dashboard then needs no file picked at all.
$record = [ordered]@{
    version = $version
    url     = ''
    sha256  = ''
    builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
if (Test-Path web/src/agent-build.json) {
    $old = Get-Content web/src/agent-build.json -Raw | ConvertFrom-Json
    if ($old.version -eq $version) {
        # Same version rebuilt locally: keep whatever the action published for it.
        $record.url = $old.url
        $record.sha256 = $old.sha256
    }
}
$record | ConvertTo-Json | Set-Content web/src/agent-build.json -Encoding utf8
Write-Host "agent version $version recorded for the dashboard"

Write-Host ''
Write-Host 'done:' -ForegroundColor Green
Get-ChildItem dist\*.exe | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
