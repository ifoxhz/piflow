# Start piFlow Windows dev (rag-server + Vite UI)
# Usage: powershell -ExecutionPolicy Bypass -File D:\dev\raglamp\scripts\dev-windows.ps1

$ErrorActionPreference = 'Stop'
Set-Location 'D:\dev\raglamp'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host 'Starting rag-server (3847) and UI (1420)...'
Start-Process powershell -ArgumentList '-NoExit','-Command','cd D:\dev\raglamp; pnpm.cmd dev:server'
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit','-Command','cd D:\dev\raglamp; pnpm.cmd dev:ui'
Start-Sleep -Seconds 3
Start-Process 'http://localhost:1420/'
Write-Host 'Done. Keep both terminals open.'
Write-Host 'For Tauri window (folder picker): cd D:\dev\raglamp\apps\desktop; pnpm tauri dev'
