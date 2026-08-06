$ErrorActionPreference = 'Stop'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
  [System.Environment]::GetEnvironmentVariable('Path', 'User')

Set-Location 'D:\dev\raglamp'

if ($env:SKIP_BUILD -ne '1') {
  Write-Host 'building portable package...'
  pnpm build:windows
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Get-Process -Name 'RAG Assistant', 'appsdesktop' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
# also free port 3847
Get-NetTCPConnection -LocalPort 3847 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep 2

$appData = Join-Path $env:APPDATA 'com.bluelamp.rag-assistant'
$sidecar = Join-Path $appData 'sidecar'
$empty = Join-Path $env:TEMP 'raglamp-empty-clean'
if (Test-Path $empty) { Remove-Item $empty -Recurse -Force }
New-Item -ItemType Directory -Path $empty | Out-Null
if (Test-Path $sidecar) {
  & robocopy $empty $sidecar /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  cmd /c ("rmdir /s /q \\?\{0}" -f $sidecar) | Out-Null
  Write-Host 'sidecar cleaned'
}
if (Test-Path $appData) {
  Get-ChildItem $appData -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem $appData -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'sidecar' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host 'app data cleared'
}
Remove-Item $empty -Recurse -Force -ErrorAction SilentlyContinue

Start-Process 'D:\dev\raglamp\dist-windows\RAG-Assistant\RAG Assistant.exe'
$ok = $false
for ($i = 0; $i -lt 120; $i++) {
  Start-Sleep 3
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:3847/health'
    Write-Host ("health {0}s {1}" -f ($i * 3), ($h | ConvertTo-Json -Compress))
    $ok = $true
    break
  } catch {
    if ($i % 5 -eq 0) { Write-Host ("wait {0}s" -f ($i * 3)) }
  }
}
if (-not $ok) { Write-Host 'HEALTH FAILED'; exit 1 }

$worker = Join-Path $env:APPDATA 'com.bluelamp.rag-assistant\sidecar\rag-server\dist\services\ingestion\embed-worker.js'
$index = Join-Path $env:APPDATA 'com.bluelamp.rag-assistant\sidecar\rag-server\dist\index.js'
Write-Host ("extract index={0} worker={1}" -f (Test-Path $index), (Test-Path $worker))
if (-not (Test-Path $index)) { Write-Host 'EXTRACT FAILED'; exit 1 }
if (Test-Path $worker) {
  if (Select-String -Path $worker -Pattern 'patchOnnxRuntimePaths' -Quiet) {
    Write-Host 'embed-worker patch present'
  } else {
    Write-Host 'WARN: embed-worker patch NOT found'
  }
}

$ingestBody = '{"path":"D:\\dev\\raglamp\\.test-docs"}'
$ingest = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3847/ingest/folder' `
  -ContentType 'application/json' -Body $ingestBody
Write-Host ("job {0}" -f $ingest.jobId)
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep 2
  $job = Invoke-RestMethod ("http://127.0.0.1:3847/ingest/jobs/{0}" -f $ingest.jobId)
  if ($i % 5 -eq 0 -or $job.status -ne 'running') {
    Write-Host ("status={0} done={1} fail={2} chunks={3}" -f `
      $job.status, $job.stats.done, $job.stats.failed, $job.stats.chunksIndexed)
  }
  if ($job.status -in @('completed', 'failed', 'cancelled')) {
    foreach ($f in $job.files) {
      if ($f.error) { Write-Host ("ERR {0}: {1}" -f $f.relativePath, $f.error) }
    }
    if ($job.status -ne 'completed' -or $job.stats.failed -gt 0 -or $job.stats.chunksIndexed -lt 1) {
      Write-Host 'INGEST FAILED'
      exit 1
    }
    break
  }
}

$chatBody = '{"message":"What is the capital of France?"}'
$chat = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3847/chat' `
  -ContentType 'application/json' -Body $chatBody -TimeoutSec 180
Write-Host 'ANSWER_BEGIN'
Write-Host $chat.reply
Write-Host 'ANSWER_END'
$cite = ($chat.citations | ConvertTo-Json -Compress)
Write-Host ("citations={0}" -f $cite)
if ($chat.reply -match 'Ollama|Paris|France|capital|retrieval|knowledge|LLM') {
  Write-Host 'SMOKE OK'
  exit 0
}
Write-Host 'SMOKE FAILED: unexpected reply'
exit 1
