<#
.SYNOPSIS
  POST a JSON fixture to a PII n8n webhook (test or production URL).

.DESCRIPTION
  Loads PII_WEBHOOK_HEADER_VALUE from the project .env, reads a JSON body file,
  and calls Invoke-RestMethod. Use after clicking "Execute workflow" / "Listen for
  test event" in n8n when targeting a webhook-test URL.

.EXAMPLE
  .\scripts\smoke\Invoke-PiiWebhook.ps1

.EXAMPLE
  .\scripts\smoke\Invoke-PiiWebhook.ps1 -Mode production

.EXAMPLE
  .\scripts\smoke\Invoke-PiiWebhook.ps1 -Uri "https://teacherjoseluis.app.n8n.cloud/webhook-test/pii/identity" -Fixture "tests/fixtures/identity-request-valid.json"
#>
[CmdletBinding()]
param(
  [ValidateSet('test', 'production')]
  [string] $Mode = 'test',

  [string] $Uri,

  [string] $Fixture = 'tests/fixtures/investigation-request-valid.json',

  [string] $EnvFile = '.env',

  [string] $HeaderName = 'X-PII-API-Key'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '../..')
Set-Location $projectRoot

function Import-DotEnvValue {
  param(
    [Parameter(Mandatory)]
    [string] $Path,
    [Parameter(Mandatory)]
    [string] $Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Env file not found: $Path"
  }

  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))=" }
  if (-not $line) {
    throw "$Key is missing from $Path"
  }

  return ($line -split '=', 2)[1].Trim()
}

if (-not $Uri) {
  $base = 'https://teacherjoseluis.app.n8n.cloud'
  $Uri = if ($Mode -eq 'production') {
    "$base/webhook/pii/investigate"
  } else {
    "$base/webhook-test/pii/investigate"
  }
}

$fixturePath = if ([System.IO.Path]::IsPathRooted($Fixture)) {
  $Fixture
} else {
  Join-Path $projectRoot $Fixture
}

if (-not (Test-Path -LiteralPath $fixturePath)) {
  throw "Fixture not found: $fixturePath"
}

$apiKey = Import-DotEnvValue -Path $EnvFile -Key 'PII_WEBHOOK_HEADER_VALUE'
if (-not $apiKey) {
  throw 'PII_WEBHOOK_HEADER_VALUE is empty — set it in .env (never commit the value)'
}

$body = Get-Content -LiteralPath $fixturePath -Raw

$headers = @{
  'Content-Type' = 'application/json'
  $HeaderName     = $apiKey
}

Write-Host "POST $Uri"
Write-Host "Fixture: $fixturePath"
Write-Host "Mode: $Mode"
Write-Host ''

$response = Invoke-RestMethod -Method POST -Uri $Uri -Headers $headers -Body $body
$response | ConvertTo-Json -Depth 10
