param(
  [string]$ConfigPath = "",
  [Parameter(Mandatory = $true)][string]$CodexBrowserCandidates,
  [Parameter(Mandatory = $true)][string]$CodexBrowserSummary,
  [switch]$LocalOnly,
  [switch]$SkipEnrichment,
  [string]$Now = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$SkillDir = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $SkillDir "config\project.local.json" }
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$CandidatePath = (Resolve-Path -LiteralPath $CodexBrowserCandidates).Path
$SummaryPath = (Resolve-Path -LiteralPath $CodexBrowserSummary).Path
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$OutputRoot = Join-Path $SkillDir $Config.project.output_root
$RunStamp = if ($Now) { (Get-Date $Now).ToString("yyyy-MM-dd_HHmmss") } else { (Get-Date).ToString("yyyy-MM-dd_HHmmss") }
$RunDir = Join-Path $OutputRoot $RunStamp
$LockPath = Join-Path $OutputRoot ".monitor.lock"

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
if (Test-Path -LiteralPath $LockPath) { throw "A monitor run is already active: $LockPath" }
New-Item -ItemType File -Path $LockPath -Force | Out-Null

$Steps = [System.Collections.Generic.List[object]]::new()
$RuntimePython = "python"
function Add-Step([string]$Name, [string]$Status, [string]$Detail = "") {
  $Steps.Add([ordered]@{ name = $Name; status = $Status; detail = $Detail; at = (Get-Date).ToString("o") })
}
function Invoke-Required([string]$Name, [scriptblock]$Action) {
  try {
    & $Action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "$Name exit code $LASTEXITCODE" }
    Add-Step $Name "success"
  }
  catch {
    Add-Step $Name "failed" $_.Exception.Message
    throw
  }
}
function Invoke-Partial([string]$Name, [scriptblock]$Action) {
  try {
    & $Action
    $ExitCode = $LASTEXITCODE
    if (-not $ExitCode -or $ExitCode -eq 0) { Add-Step $Name "success"; return }
    if ($ExitCode -eq 2) { Add-Step $Name "partial" "Completed with partial artifacts"; return }
    throw "$Name exit code $ExitCode"
  }
  catch {
    Add-Step $Name "failed" $_.Exception.Message
    throw
  }
}
function Write-JsonNoBom([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
}

try {
  Invoke-Required "validate_config" { & node (Join-Path $PSScriptRoot "validate-config.mjs") $ConfigPath }
  Invoke-Required "validate_browser_artifacts" {
    & node (Join-Path $PSScriptRoot "validate-browser-artifacts.mjs") `
      "--config=$ConfigPath" "--candidates=$CandidatePath" "--summary=$SummaryPath"
  }

  $Normalized = Join-Path $RunDir "normalized-candidates.json"
  $CollectionSummary = Join-Path $RunDir "collection-summary.json"
  Copy-Item -LiteralPath $CandidatePath -Destination $Normalized -Force
  Copy-Item -LiteralPath $SummaryPath -Destination $CollectionSummary -Force
  Add-Step "accept_codex_browser_collection" "success" "Validated Codex in-app browser artifacts"

  if (-not $SkipEnrichment -and ($Config.enrichment.ocr_enabled -or $Config.enrichment.transcription_enabled)) {
    $VenvPython = if ($IsLinux -or $IsMacOS) { Join-Path $SkillDir ".venv/bin/python" } else { Join-Path $SkillDir ".venv\Scripts\python.exe" }
    $RuntimeMarker = Join-Path $SkillDir "work\runtime-ready.json"
    $DependenciesMarker = Join-Path $SkillDir "work\runtime-dependencies-ready.json"
    $NeedsWhisperModel = $Config.enrichment.transcription_enabled -eq $true
    $RuntimeReady = $false
    if ($NeedsWhisperModel -and (Test-Path -LiteralPath $RuntimeMarker)) {
      try {
        $RuntimeStatus = Get-Content -LiteralPath $RuntimeMarker -Raw -Encoding UTF8 | ConvertFrom-Json
        $RuntimeReady = $RuntimeStatus.model_downloaded -eq $true -and [string]$RuntimeStatus.whisper_model -eq [string]$Config.enrichment.whisper_model
      }
      catch { $RuntimeReady = $false }
    }
    elseif (-not $NeedsWhisperModel) {
      $RuntimeReady = (Test-Path -LiteralPath $DependenciesMarker) -or (Test-Path -LiteralPath $RuntimeMarker)
    }
    if (-not (Test-Path -LiteralPath $VenvPython) -or -not $RuntimeReady) {
      Invoke-Required "install_dependencies" {
        if ($NeedsWhisperModel) {
          & (Join-Path $PSScriptRoot "install-dependencies.ps1") -ConfigPath $ConfigPath
        }
        else {
          & (Join-Path $PSScriptRoot "install-dependencies.ps1") -ConfigPath $ConfigPath -SkipModelDownload
        }
      }
    }
    else {
      Add-Step "install_dependencies" "success" "Reused local verified runtime"
    }
    $RuntimePython = $VenvPython
  }

  $OcrMap = Join-Path $RunDir "cover-titles.json"
  if (-not $SkipEnrichment -and $Config.enrichment.ocr_enabled) {
    Invoke-Partial "ocr_covers" {
      $OcrArgs = @("--input", $Normalized, "--output", $OcrMap, "--cache-dir", (Join-Path $RunDir "cover-cache"), "--config", $ConfigPath)
      if ($Now) { $OcrArgs += @("--now", $Now) }
      & $RuntimePython (Join-Path $PSScriptRoot "ocr-covers.py") @OcrArgs
    }
  }
  else {
    Write-JsonNoBom $OcrMap @{}
    Add-Step "ocr_covers" "skipped" "Disabled by configuration or -SkipEnrichment"
  }

  $StatePath = Join-Path $OutputRoot "state.json"
  Invoke-Partial "build_ranking" {
    $RankingArgs = @(
      "--input=$Normalized", "--output-dir=$RunDir", "--config=$ConfigPath",
      "--state=$StatePath", "--ocr-map=$OcrMap", "--collection-summary=$CollectionSummary"
    )
    if ($Now) { $RankingArgs += "--now=$Now" }
    & node (Join-Path $PSScriptRoot "build-ranking.mjs") @RankingArgs
  }

  if (-not $SkipEnrichment -and $Config.enrichment.transcription_enabled) {
    Invoke-Partial "transcribe_ranking" {
      & $RuntimePython (Join-Path $PSScriptRoot "transcribe-ranking.py") `
        --candidates $Normalized --config $ConfigPath --output-dir $RunDir `
        --cache-dir (Join-Path $OutputRoot "transcript-cache")
    }
  }
  else {
    Add-Step "transcribe_ranking" "skipped" "Disabled by configuration or -SkipEnrichment"
  }

  $RunSummaryPath = Join-Path $RunDir "run-summary.json"
  $RunSummary = Get-Content -LiteralPath $RunSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $PartialSteps = @($Steps | Where-Object { $_.status -eq "partial" })
  if ($PartialSteps.Count) {
    $RunSummary.status = "partial"
    $ExistingFailures = @($RunSummary.source_failures)
    $StepFailures = @($PartialSteps | ForEach-Object { "$($_.name): $($_.detail)" })
    $RunSummary.source_failures = @($ExistingFailures + $StepFailures | Select-Object -Unique)
    Write-JsonNoBom $RunSummaryPath $RunSummary
  }

  Copy-Item -LiteralPath (Join-Path $RunDir "updated-state.json") -Destination $StatePath -Force

  if (-not $LocalOnly) {
    if (-not $Config.feishu.enabled) { throw "Feishu is disabled; use -LocalOnly or finish local Feishu setup" }
    Invoke-Required "write_feishu" {
      & (Join-Path $PSScriptRoot "write-feishu.ps1") -RunDir $RunDir -ConfigPath $ConfigPath
    }
  }
  else {
    Add-Step "write_feishu" "skipped" "Local-only run"
  }
}
catch {
  Add-Step "run_result" "failed" $_.Exception.Message
  throw
}
finally {
  $Failed = @($Steps | Where-Object { $_.status -eq "failed" }).Count
  $Partial = @($Steps | Where-Object { $_.status -eq "partial" }).Count
  $RunStatus = if ($Failed) { "failed" } elseif ($Partial) { "partial" } else { "complete" }
  Write-JsonNoBom (Join-Path $RunDir "run-log.json") ([ordered]@{
    run_id = $RunStamp
    status = $RunStatus
    local_only = [bool]$LocalOnly
    steps = $Steps
    completed_at = (Get-Date).ToString("o")
  })
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}

Write-Output "Run artifacts: $RunDir"
