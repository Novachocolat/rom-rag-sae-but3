#Requires -Version 5.1
<#
.SYNOPSIS
  Imports every No-Intro .dat catalog of dataset/dat/ not imported yet.
.DESCRIPTION
  Requires the backend answering: by default the one of the Docker stack
  (`npm run docker:dev`), checked through Docker.
  Works with Windows PowerShell 5.1 and PowerShell 7+ (Windows, macOS, Linux).
.PARAMETER ApiUrl
  Base URL of the API (defaults to http://localhost:<PORT from .env>/api, or to
  the API_URL environment variable). When set, the Docker checks are skipped,
  to target a backend running elsewhere (remote, or `npm run dev`).
.PARAMETER Force
  Replaces the catalogs already imported under the same file name (deleted,
  then imported again) instead of skipping them. Alias: -F.
.EXAMPLE
  ./scripts/import-dat.ps1
.EXAMPLE
  ./scripts/import-dat.ps1 -Force
#>
param(
  [string]$ApiUrl = $env:API_URL,
  [Alias('F')]
  [switch]$Force
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

# Backend JSON error ({ error: { code, message } }), or $null. PowerShell 7 fills
# ErrorDetails, Windows PowerShell 5.1 only gives the response stream (read once)
function Get-ApiError($ErrorRecord) {
  try {
    $body = $ErrorRecord.ErrorDetails.Message
    if (-not $body) {
      $body = (New-Object System.IO.StreamReader($ErrorRecord.Exception.Response.GetResponseStream())).ReadToEnd()
    }
    return ($body | ConvertFrom-Json -ErrorAction Stop).error
  } catch { return $null }
}

# Whether the request failed because of the client timeout (the server may still be working)
function Test-IsTimeout($ErrorRecord) {
  $exception = $ErrorRecord.Exception
  while ($exception) {
    if ($exception -is [System.TimeoutException] -or
        $exception -is [System.Threading.Tasks.TaskCanceledException]) { return $true }
    if ($exception -is [System.Net.WebException] -and
        $exception.Status -eq [System.Net.WebExceptionStatus]::Timeout) { return $true }
    $exception = $exception.InnerException
  }
  return $false
}

# Prints the counters, also before an abort so that finished imports are not lost
function Write-Summary {
  Write-Host "`n$script:imported imported, $script:replaced replaced, $script:skipped skipped, $script:failed failed."
}

# Counts the file as failed, prints the counters, then stops the script. A timeout
# means the server may still be working, so do not replay yet
function Stop-Unreachable([string]$FileName, $ErrorRecord, [string]$Step) {
  Write-Host 'failed' -ForegroundColor Red
  $script:failed++
  Write-Summary
  if (Test-IsTimeout $ErrorRecord) {
    Stop-WithError "Timed out waiting for the $Step of $FileName. The backend may still be working on it: check `"npm run docker:dev:logs`" and wait for it to end before running the script again."
  }
  Stop-WithError "The backend stopped answering during the $Step of $FileName."
}

# Reads PORT from .env, like docker-compose.yml does (defaults to 3000)
$customApiUrl = [bool]$ApiUrl
if (-not $ApiUrl) {
  $port = '3000'
  $envFile = Join-Path $RootDir '.env'
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^PORT=' } | Select-Object -Last 1
    if ($line) { $port = ($line -replace '^PORT=', '').Trim().Trim('"') }
  }
  $ApiUrl = "http://localhost:$port/api"
}

# 1. Without ApiUrl, Docker must be installed, running, and the stack started
if (-not $customApiUrl) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-WithError 'Docker is not installed (https://docs.docker.com/get-docker/). To target a backend running elsewhere, set API_URL.'
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError 'Docker is not running. Start Docker Desktop (or the Docker daemon), then run "npm run docker:dev".'
  }
  docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError 'Docker Compose v2 is required ("docker compose", not "docker-compose"). To target a backend running elsewhere, set API_URL.'
  }
  $services = docker compose -f (Join-Path $RootDir 'docker-compose.yml') ps --status running --services 2> $null
  if (@($services) -notcontains 'backend') {
    Stop-WithError 'The backend container is not running. Start the stack with "npm run docker:dev" first, or set API_URL to target another backend.'
  }
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

# 3. Catalogs already imported, to skip (or replace) them
try {
  $catalog = @((Invoke-RestMethod -Uri "$ApiUrl/dat" -TimeoutSec 10 -ErrorAction Stop).data)
} catch {
  Stop-WithError "Could not list the imported catalogs (GET $ApiUrl/dat)."
}

$files = @(Get-ChildItem -LiteralPath $DatDir -File | Where-Object { $_.Extension -eq '.dat' } | Sort-Object Name)
if ($files.Count -eq 0) { Stop-WithError "No .dat file found in $DatDir" }

$imported = 0
$replaced = 0
$skipped = 0
$failed = 0

Write-Host "Importing .dat catalogs from $DatDir`n"

foreach ($file in $files) {
  $existing = @($catalog | Where-Object { $_.fileName -eq $file.Name })
  $replacing = $existing.Count -gt 0
  if ($replacing -and -not $Force) {
    Write-Host "  skipped   $($file.Name) (already imported, use -Force to replace it)"
    $skipped++
    continue
  }

  # 4. Replacing: the catalogs of the same file name are deleted first, with their entries
  if ($replacing) {
    Write-Host "  replacing $($file.Name)... " -NoNewline
    $deleteFailed = $false
    foreach ($entry in $existing) {
      try {
        $null = Invoke-RestMethod -Method Delete -Uri "$ApiUrl/dat/$($entry.id)" -TimeoutSec 30 -ErrorAction Stop
      } catch {
        $status = Get-HttpStatus $_
        if ($status -eq 0) { Stop-Unreachable $file.Name $_ 'deletion' }
        $apiError = Get-ApiError $_
        if ($apiError.code -eq 'FOREIGN_KEY_CONSTRAINT') {
          # ROMs matched against this catalog still reference its entries
          $message = 'ROMs still reference this catalog, it cannot be replaced'
        } else {
          $message = if ($apiError.message) { $apiError.message } else { $_.Exception.Message }
        }
        Write-Host "failed (HTTP ${status}: $message)" -ForegroundColor Red
        $failed++
        $deleteFailed = $true
        break
      }
    }
    if ($deleteFailed) { continue }
  } else {
    Write-Host "  importing $($file.Name)... " -NoNewline
  }

  # UTF-8 bytes, since Windows PowerShell 5.1 would send the body as ISO-8859-1
  $body = [Text.Encoding]::UTF8.GetBytes((@{ fileName = $file.Name } | ConvertTo-Json -Compress))

  try {
    $result = Invoke-RestMethod -Method Post -Uri "$ApiUrl/dat/import" `
      -ContentType 'application/json; charset=utf-8' -Body $body `
      -TimeoutSec 600 -ErrorAction Stop
    Write-Host "done ($($result.insertedEntries) entries)" -ForegroundColor Green
    if ($replacing) { $replaced++ } else { $imported++ }
  } catch {
    $status = Get-HttpStatus $_
    $apiError = Get-ApiError $_
    if ($status -eq 409 -and $apiError.code -eq 'DAT_ALREADY_IMPORTED') {
      # Same content already imported (e.g. under another file name); any other
      # conflict is a real failure
      if ($replacing) {
        Write-Host 'skipped (same content already imported under another file name, the previous version was removed)'
      } else {
        Write-Host 'skipped (same content already imported)'
      }
      $skipped++
    } elseif ($status -eq 0) {
      Stop-Unreachable $file.Name $_ 'import'
    } else {
      $message = if ($apiError.message) { $apiError.message } else { $_.Exception.Message }
      Write-Host "failed (HTTP ${status}: $message)" -ForegroundColor Red
      if ($replacing) { Write-Host '    the previous version was removed: run the script again to import it.' }
      $failed++
    }
  }
}

Write-Summary
Wait-IfLaunchedFromExplorer
if ($failed -gt 0) { exit 1 }
