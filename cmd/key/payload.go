package main

import _ "embed"

// agentBinary is the installed agent (projectBV.exe) embedded straight into the
// key, so the USB "key" is a single self-contained file. build.ps1 drops the
// freshly built agent into agent_payload/ before compiling the key; during plain
// `go build ./...` a tiny placeholder is embedded instead (see the size check in
// main.go, which then falls back to a sibling projectBV.exe on the USB).
//
//go:embed agent_payload/projectBV.exe
var agentBinary []byte
