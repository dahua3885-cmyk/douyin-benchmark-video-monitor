param(
  [string]$ConfigPath = "",
  [switch]$SkipModelDownload
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$SkillDir = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Join-Path $SkillDir "config\project.local.json" }
$VenvDir = Join-Path $SkillDir ".venv"
$VenvPython = if ($IsLinux -or $IsMacOS) { Join-Path $VenvDir "bin/python" } else { Join-Path $VenvDir "Scripts\python.exe" }
$MarkerDir = Join-Path $SkillDir "work"
$MarkerPath = Join-Path $MarkerDir "runtime-ready.json"
$DependenciesMarkerPath = Join-Path $MarkerDir "runtime-dependencies-ready.json"

if (-not (Test-Path -LiteralPath $VenvPython)) {
  & python -m venv $VenvDir
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the local Python virtual environment" }
}

& $VenvPython -m pip install --disable-pip-version-check --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Unable to update pip in the local virtual environment" }
& $VenvPython -m pip install --disable-pip-version-check -r (Join-Path $SkillDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Unable to install transcription and OCR dependencies" }

$Model = "base"
if (Test-Path -LiteralPath $ConfigPath) {
  $Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace([string]$Config.enrichment.whisper_model)) {
    $Model = [string]$Config.enrichment.whisper_model
  }
}
$PrepareArgs = @((Join-Path $PSScriptRoot "prepare-runtime.py"), "--model", $Model)
if ($SkipModelDownload) { $PrepareArgs += "--skip-model-download" }
$RuntimeJson = & $VenvPython @PrepareArgs
if ($LASTEXITCODE -ne 0) { throw "Runtime verification or model download failed" }
$RuntimeData = ($RuntimeJson -join "`n") | ConvertFrom-Json
$RuntimeData | Add-Member -NotePropertyName "requirements_sha256" -NotePropertyValue ((Get-FileHash -LiteralPath (Join-Path $SkillDir "requirements.txt") -Algorithm SHA256).Hash.ToLowerInvariant()) -Force
$RuntimeJson = $RuntimeData | ConvertTo-Json -Depth 10

New-Item -ItemType Directory -Path $MarkerDir -Force | Out-Null
if ($SkipModelDownload) {
  [System.IO.File]::WriteAllText($DependenciesMarkerPath, $RuntimeJson, [System.Text.UTF8Encoding]::new($false))
}
else {
  [System.IO.File]::WriteAllText($MarkerPath, $RuntimeJson, [System.Text.UTF8Encoding]::new($false))
}
Write-Output $RuntimeJson
