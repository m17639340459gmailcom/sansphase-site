$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$previewUrl = 'http://127.0.0.1:4176/'
$alreadyRunning = $false
try {
  $response = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
  if ($response.Headers['X-Preview-App'] -eq 'sansphase-local') { $alreadyRunning = $true }
  else { throw 'Port 4176 is in use by another application.' }
} catch {
  if ($_.Exception.Message -eq 'Port 4176 is in use by another application.') { throw }
}
if (-not $alreadyRunning) {
  $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNode) { $nodeExecutable = $bundledNode }
  else { $nodeExecutable = (Get-Command node -ErrorAction Stop).Source }
  $logDirectory = Join-Path $projectDirectory '.preview'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $serverScript = Join-Path $projectDirectory 'scripts\dev.mjs'
  Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri $previewUrl -UseBasicParsing -TimeoutSec 2
      if ($response.Headers['X-Preview-App'] -eq 'sansphase-local') { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw 'Preview failed to start. Check .preview/server-error.log.' }
}
Start-Process $previewUrl
