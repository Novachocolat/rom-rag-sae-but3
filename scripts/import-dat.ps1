#Requires -Version 5.1
<#
.SYNOPSIS
  Imports every No-Intro .dat catalog of dataset/dat/ not imported yet.
.DESCRIPTION
  Requires Docker running and the backend answering (`npm run docker:dev`).
  Works with Windows PowerShell 5.1 and PowerShell 7+ (Windows, macOS, Linux).
.PARAMETER ApiUrl
  Base URL of the API (defaults to http://localhost:<PORT from .env>/api).
.EXAMPLE
  ./scripts/import-dat.ps1
#>
param(
  [string]$ApiUrl = $env:API_URL
)

$RootDir = Split-Path -Parent $PSScriptRoot
$DatDir = Join-Path (Join-Path $RootDir 'dataset') 'dat'

# Keeps the window open when launched by "Run with PowerShell" from Explorer
function Wait-IfLaunchedFromExplorer {
  if ($PSVersionTable.PSEdition -eq 'Core' -and -not $IsWindows) { return }
  try {
    $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
    $parent = Get-Process -Id $parentId -ErrorAction Stop
    if ($parent.ProcessName -eq 'explorer') { Read-Host 'Press Enter to close' | Out-Null }
  } catch { }
}

# Prints a clear error message and stops the script
function Stop-WithError([string]$Message) {
  Write-Host "Error: $Message" -ForegroundColor Red
  Wait-IfLaunchedFromExplorer
  exit 1
}

# HTTP status of a failed Invoke-RestMethod call (0 if the server never answered)
function Get-HttpStatus($ErrorRecord) {
  if ($ErrorRecord.Exception.Response) { return [int]$ErrorRecord.Exception.Response.StatusCode }
  return 0
}

# Message of the backend JSON error ({ error: { message } }), if any
function Get-ApiErrorMessage($ErrorRecord) {
  try { return ($ErrorRecord.ErrorDetails.Message | ConvertFrom-Json).error.message }
  catch { return $ErrorRecord.Exception.Message }
}

# Reads PORT from .env, like docker-compose.yml does (defaults to 3000)
if (-not $ApiUrl) {
  $port = '3000'
  $envFile = Join-Path $RootDir '.env'
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^PORT=' } | Select-Object -Last 1
    if ($line) { $port = ($line -replace '^PORT=', '').Trim().Trim('"') }
  }
  $ApiUrl = "http://localhost:$port/api"
}

# 1. Docker must be installed, running, and the stack started
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-WithError 'Docker is not installed (https://docs.docker.com/get-docker/).'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Stop-WithError 'Docker is not running. Start Docker Desktop (or the Docker daemon), then run "npm run docker:dev".'
}
$services = docker compose -f (Join-Path $RootDir 'docker-compose.yml') ps --status running --services 2> $null
if (@($services) -notcontains 'backend') {
  Stop-WithError 'The backend container is not running. Start the stack with "npm run docker:dev" first.'
}

# 2. The backend must answer, with PostgreSQL and Redis up
try {
  $null = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec 5 -ErrorAction Stop
} catch {
  $status = Get-HttpStatus $_
  if ($status -eq 503) { Stop-WithError 'The backend answers but PostgreSQL or Redis is down. Check "npm run docker:dev:logs".' }
  if ($status -ne 0) { Stop-WithError "Unexpected answer from $ApiUrl/health (HTTP $status)." }
  Stop-WithError "The backend does not answer on $ApiUrl. Wait until it has started (npm run docker:dev:logs), then retry."
}

if (-not (Test-Path -LiteralPath $DatDir -PathType Container)) {
  Stop-WithError "Directory not found: $DatDir"
}

# 3. Catalogs already imported, to skip them without re-reading them
try {
  $catalog = (Invoke-RestMethod -Uri "$ApiUrl/dat" -TimeoutSec 10 -ErrorAction Stop).data
} catch {
  Stop-WithError "Could not list the imported catalogs (GET $ApiUrl/dat)."
}
$importedNames = @($catalog | ForEach-Object { $_.fileName })

$files = @(Get-ChildItem -LiteralPath $DatDir -File | Where-Object { $_.Extension -eq '.dat' } | Sort-Object Name)
if ($files.Count -eq 0) { Stop-WithError "No .dat file found in $DatDir" }

$imported = 0
$skipped = 0
$failed = 0

Write-Host "Importing .dat catalogs from $DatDir`n"

foreach ($file in $files) {
  if ($importedNames -contains $file.Name) {
    Write-Host "  skipped   $($file.Name) (already imported)"
    $skipped++
    continue
  }

  Write-Host "  importing $($file.Name)... " -NoNewline
  # UTF-8 bytes, since Windows PowerShell 5.1 would send the body as ISO-8859-1
  $body = [Text.Encoding]::UTF8.GetBytes((@{ fileName = $file.Name } | ConvertTo-Json -Compress))

  try {
    $result = Invoke-RestMethod -Method Post -Uri "$ApiUrl/dat/import" `
      -ContentType 'application/json; charset=utf-8' -Body $body `
      -TimeoutSec 600 -ErrorAction Stop
    Write-Host "done ($($result.insertedEntries) entries)" -ForegroundColor Green
    $imported++
  } catch {
    $status = Get-HttpStatus $_
    if ($status -eq 409) {
      # Same content already imported under another file name
      Write-Host 'skipped (same content already imported)'
      $skipped++
    } elseif ($status -eq 0) {
      Write-Host 'failed' -ForegroundColor Red
      Stop-WithError "The backend stopped answering while importing $($file.Name)."
    } else {
      Write-Host "failed (HTTP ${status}: $(Get-ApiErrorMessage $_))" -ForegroundColor Red
      $failed++
    }
  }
}

Write-Host "`n$imported imported, $skipped skipped, $failed failed."
Wait-IfLaunchedFromExplorer
if ($failed -gt 0) { exit 1 }
