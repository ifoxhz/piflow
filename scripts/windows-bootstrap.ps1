$ErrorActionPreference = 'Continue'

$envFile = 'D:\dev\raglamp\.env'
$c = Get-Content $envFile -Raw
if ($c -notmatch 'VITE_RAG_SERVER_URL') {
  Add-Content $envFile "`nVITE_RAG_SERVER_URL=http://127.0.0.1:3847"
  Write-Host 'Added VITE_RAG_SERVER_URL'
} else {
  Write-Host 'VITE already present'
}
Write-Host '--- .env ---'
Get-Content $envFile

Write-Host '=== Installing Rustup ==='
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements --disable-interactivity
Write-Host ("rustup_exit=" + $LASTEXITCODE)

Write-Host '=== Installing VS Build Tools 2022 (VCTools) ==='
# May require elevation / UAC
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --disable-interactivity --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
Write-Host ("vs_exit=" + $LASTEXITCODE)

Write-Host '=== Installing WebView2 Runtime (idempotent) ==='
winget install --id Microsoft.EdgeWebView2Runtime -e --accept-package-agreements --accept-source-agreements --disable-interactivity
Write-Host ("webview_exit=" + $LASTEXITCODE)

Write-Host '=== PATH refresh check ==='
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
Write-Host ('rustc=' + (Get-Command rustc -ErrorAction SilentlyContinue).Source)
Write-Host ('cargo=' + (Get-Command cargo -ErrorAction SilentlyContinue).Source)
try { rustc -V } catch { Write-Host 'rustc not ready' }
try { cargo -V } catch { Write-Host 'cargo not ready' }
