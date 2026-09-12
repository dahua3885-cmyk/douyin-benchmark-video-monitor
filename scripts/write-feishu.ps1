param(
  [Parameter(Mandatory = $true)][string]$RunDir,
  [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$RunDir = (Resolve-Path -LiteralPath $RunDir).Path
$ConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$Config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $Config.feishu.enabled) { throw "Feishu is not enabled" }
if ($Config.feishu.identity -ne "bot") { throw "Unattended Feishu writes require bot identity" }

$BaseToken = [string]$Config.feishu.base_token
$VideosTable = [string]$Config.feishu.tables.videos.table_id
$SnapshotsTable = [string]$Config.feishu.tables.snapshots.table_id
$RunsTable = [string]$Config.feishu.tables.runs.table_id
$RequiredArtifacts = @("combined-ranking.json", "daily-snapshots.json", "run-summary.json")
foreach ($Name in $RequiredArtifacts) {
  if (-not (Test-Path -LiteralPath (Join-Path $RunDir $Name))) { throw "Missing run artifact: $Name" }
}

function Write-JsonNoBom([string]$Path, [object]$Value) {
  [System.IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
}
function Invoke-LarkJson([string[]]$Arguments) {
  $Raw = (& lark-cli @Arguments | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "lark-cli exit code $LASTEXITCODE`n$Raw" }
  return $Raw | ConvertFrom-Json
}
function Search-Record([string]$TableId, [string]$Keyword, [string]$SearchField) {
  return Invoke-LarkJson -Arguments @(
    "base", "+record-search", "--base-token", $BaseToken, "--table-id", $TableId,
    "--keyword", $Keyword, "--search-field", $SearchField, "--field-id", $SearchField,
    "--limit", "10", "--format", "json", "--as", "bot"
  )
}
function Convert-MultiSelectFields([object]$Row) {
  $Map = [ordered]@{}
  foreach ($Property in $Row.PSObject.Properties) { $Map[$Property.Name] = $Property.Value }
  foreach ($Name in @("来源类型", "命中关键词", "入榜关键词", "来源窗口")) {
    if ($Map.Contains($Name)) { $Map[$Name] = @(([string]$Map[$Name]).Split("；", [System.StringSplitOptions]::RemoveEmptyEntries)) }
  }
  return $Map
}
function Upsert-Verified([string]$TableId, [string]$KeyField, [string]$Key, [object]$Row) {
  $Found = Search-Record $TableId $Key $KeyField
  $Ids = @($Found.data.record_id_list)
  if ($Ids.Count -gt 1) { throw "Duplicate business key in Base: $Key" }
  $PayloadName = ".feishu-$([guid]::NewGuid().ToString('N')).json"
  $PayloadPath = Join-Path $RunDir $PayloadName
  Write-JsonNoBom $PayloadPath $Row
  $Arguments = @("base", "+record-upsert", "--base-token", $BaseToken, "--table-id", $TableId)
  if ($Ids.Count -eq 1) { $Arguments += @("--record-id", [string]$Ids[0]) }
  $Arguments += @("--json", "@$PayloadName", "--as", "bot")
  $null = Invoke-LarkJson -Arguments $Arguments
  $Verified = Search-Record $TableId $Key $KeyField
  if (@($Verified.data.record_id_list).Count -ne 1) { throw "Feishu write verification failed: $Key" }
  Remove-Item -LiteralPath $PayloadPath -Force -ErrorAction SilentlyContinue
  if ($Ids.Count -eq 1) { return "updated" }
  return "created"
}

$Videos = Get-Content -LiteralPath (Join-Path $RunDir "combined-ranking.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Snapshots = Get-Content -LiteralPath (Join-Path $RunDir "daily-snapshots.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Summary = Get-Content -LiteralPath (Join-Path $RunDir "run-summary.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Collection = Get-Content -LiteralPath (Join-Path $RunDir "collection-summary.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Created = 0
$Updated = 0

Push-Location $RunDir
try {
  & node (Join-Path $PSScriptRoot "ensure-feishu-views.mjs") "--config=$ConfigPath"
  if ($LASTEXITCODE -ne 0) { throw "Feishu view setup failed with exit code $LASTEXITCODE" }

  foreach ($Video in @($Videos)) {
    $Action = Upsert-Verified $VideosTable "唯一键" ([string]$Video.'唯一键') (Convert-MultiSelectFields $Video)
    if ($Action -eq "created") { $Created += 1 } else { $Updated += 1 }
  }
  foreach ($Snapshot in @($Snapshots)) {
    $null = Upsert-Verified $SnapshotsTable "快照ID" ([string]$Snapshot.'快照ID') $Snapshot
  }

  $AccountSuccess = @($Collection.accounts | Where-Object { $_.status -eq "success" }).Count
  $KeywordSuccess = @($Collection.keywords | Where-Object { $_.status -in @("success_with_results", "success_empty") }).Count
  $FailureText = (@($Summary.source_failures) -join "；")
  $RunId = Split-Path -Leaf $RunDir
  $RunRow = [ordered]@{
    "运行ID" = $RunId
    "开始时间" = [string]$Collection.captured_at
    "结束时间" = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "状态" = [string]$Summary.status
    "账号采集" = "$AccountSuccess/$(@($Collection.accounts).Count)"
    "关键词采集" = "$KeywordSuccess/$(@($Collection.keywords).Count)"
    "账号榜视频" = [int]$Summary.account_ranking_count
    "关键词榜视频" = [int]$Summary.keyword_ranking_count
    "综合唯一视频" = [int]$Summary.combined_unique_count
    "失败说明" = $FailureText
  }
  $null = Upsert-Verified $RunsTable "运行ID" $RunId $RunRow

  $WriteSummary = [ordered]@{
    status = "complete"
    videos_created = $Created
    videos_updated = $Updated
    videos_verified = @($Videos).Count
    snapshots_verified = @($Snapshots).Count
    run_log_verified = $true
  }
  Write-JsonNoBom (Join-Path $RunDir "feishu-write-summary.json") $WriteSummary
  $WriteSummary | ConvertTo-Json -Depth 10
}
finally {
  Get-ChildItem -LiteralPath $RunDir -Filter ".feishu-*.json" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Pop-Location
}
