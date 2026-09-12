param(
  [Parameter(Mandatory = $true)][string]$VerificationUrl,
  [string]$OutputRelativePath = "work/setup/feishu-authorization.png",
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$SkillDir = Split-Path -Parent $PSScriptRoot
$RelativeParts = $OutputRelativePath -split '[\\/]'
if ([System.IO.Path]::IsPathRooted($OutputRelativePath) -or $RelativeParts -contains "..") {
  throw "OutputRelativePath must stay inside the Skill directory"
}
$QrPath = [System.IO.Path]::GetFullPath((Join-Path $SkillDir $OutputRelativePath))
$SetupDir = Split-Path -Parent $QrPath
New-Item -ItemType Directory -Path $SetupDir -Force | Out-Null

Push-Location $SkillDir
try {
  & lark-cli auth qrcode $VerificationUrl --output ($OutputRelativePath -replace '\\', '/') --size 360
  if ($LASTEXITCODE -ne 0) { throw "lark-cli auth qrcode failed with exit code $LASTEXITCODE" }
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $QrPath)) { throw "QR image was not created: $QrPath" }
if (-not $NoOpen) {
  Start-Process -FilePath $QrPath -WindowStyle Normal
}

[ordered]@{
  status = "ready"
  verification_url = $VerificationUrl
  qr_path = $QrPath
  opened = (-not $NoOpen)
} | ConvertTo-Json -Depth 5
