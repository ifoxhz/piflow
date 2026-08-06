$ErrorActionPreference = 'Continue'
$setup = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
if (-not (Test-Path $setup)) {
  Write-Host "setup.exe missing: $setup"
  exit 1
}

Write-Host "Modifying BuildTools to add VCTools workload..."
# Use modify on existing install
& $setup modify `
  --installPath "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools" `
  --add Microsoft.VisualStudio.Workload.VCTools `
  --includeRecommended `
  --passive `
  --norestart `
  --wait

Write-Host ("setup_exit=" + $LASTEXITCODE)

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
Write-Host '=== after modify ==='
& $vswhere -all -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName,installationPath,isComplete,isLaunchable
& $vswhere -all -products * -property displayName,isComplete,isLaunchable,installationVersion
