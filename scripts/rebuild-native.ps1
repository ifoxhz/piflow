$ErrorActionPreference = 'Continue'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
$env:PYTHON = 'C:\Users\yong.zheng\AppData\Local\Programs\Python\Python312\python.exe'
$env:npm_config_python = $env:PYTHON

$vsDev = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat'
cmd /c "`"$vsDev`" -arch=x64 && set" | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
  }
}

Set-Location 'D:\dev\raglamp'
Write-Host "python=$env:PYTHON"
& $env:PYTHON --version
Write-Host "cl=$((Get-Command cl -ErrorAction SilentlyContinue).Source)"

Write-Host '=== pnpm install (run native scripts) ==='
pnpm install 2>&1
Write-Host ("install_exit=" + $LASTEXITCODE)

$binding = 'D:\dev\raglamp\node_modules\.pnpm\better-sqlite3@11.10.0\node_modules\better-sqlite3\build\Release\better_sqlite3.node'
Write-Host ("binding_exists=" + (Test-Path $binding))
if (-not (Test-Path $binding)) {
  Write-Host '=== forced rebuild better-sqlite3 ==='
  Push-Location 'D:\dev\raglamp\node_modules\.pnpm\better-sqlite3@11.10.0\node_modules\better-sqlite3'
  pnpm exec node-gyp rebuild --release 2>&1
  # fallback npm rebuild via package scripts
  npm run install 2>&1
  Pop-Location
  Write-Host ("binding_exists_after=" + (Test-Path $binding))
}
