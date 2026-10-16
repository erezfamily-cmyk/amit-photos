# Adds ONE allowed secret to the Preview of PR #155 ONLY (Worker amit-photos-paypal-sandbox,
# preview for feature/digital-checkout-preparation-2026-10-13), or removes it.
#   pwsh -File add-preview-secret.ps1 -Name CALLMEBOT_TELEGRAM_USER -CheckOnly   # read-only
#   pwsh -File add-preview-secret.ps1 -Name CALLMEBOT_TELEGRAM_USER              # asks (hidden) and adds
#   pwsh -File add-preview-secret.ps1 -Name RESEND_API_KEY -Remove               # removes it again
# The value is read with a hidden prompt, lives only in memory, is sent once over HTTPS to the
# Cloudflare API, is never written to a file, never printed, and is not on the command line (so not
# in shell history). Only the names below are accepted, and the script refuses to run unless both
# payment flags of this Preview are "false".
param(
  [Parameter(Mandatory = $true)][ValidateSet('RESEND_API_KEY', 'CALLMEBOT_TELEGRAM_USER')][string]$Name,
  [switch]$CheckOnly,
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$Account = '439cc74123631d21ff905817aca9785d'
$Worker  = 'amit-photos-paypal-sandbox'
$Preview = '8ef9ae2781484d48b596b3da8815f6f9'
$Url = "https://api.cloudflare.com/client/v4/accounts/$Account/workers/workers/$Worker/previews/$Preview/deployments/latest"
$Shapes = @{
  RESEND_API_KEY          = '^re_[A-Za-z0-9_\-]{16,}$'
  CALLMEBOT_TELEGRAM_USER = '^[A-Za-z0-9_]{3,64}$'
}

$lines = & npx -y wrangler@4.149.0 auth token 2>$null
$token = ($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[A-Za-z0-9_.-]{20,}$' } | Select-Object -Last 1)
if (-not $token) { throw 'No wrangler login found. Run "npx wrangler login" first, then run this script again.' }
$headers = @{ Authorization = "Bearer $token" }

function Show-State($deployment, [string]$title) {
  $env = $deployment.result.env
  Write-Host $title
  Write-Host ('  deployment id         : ' + $deployment.result.id)
  Write-Host ('  PAYMENTS_ENABLED      : ' + $env.PAYMENTS_ENABLED.text)
  Write-Host ('  DIGITAL_PAYPAL_ENABLED: ' + $env.DIGITAL_PAYPAL_ENABLED.text)
  foreach ($n in $Shapes.Keys) { Write-Host ('  ' + $n.PadRight(22) + ': ' + $(if ($env.$n) { 'present (' + $env.$n.type + ')' } else { 'absent' })) }
  Write-Host ('  PAYMENT_ALERTS_ENABLED: ' + $(if ($env.PAYMENT_ALERTS_ENABLED) { $env.PAYMENT_ALERTS_ENABLED.text } else { 'absent' }))
}

$before = Invoke-RestMethod -Uri $Url -Headers $headers
Show-State $before 'Before:'
if ($before.result.env.PAYMENTS_ENABLED.text -ne 'false' -or $before.result.env.DIGITAL_PAYPAL_ENABLED.text -ne 'false') {
  throw 'Refusing: a payment flag of this Preview is not "false".'
}
if ($CheckOnly) { Write-Host 'Check only: nothing was changed.'; return }

if ($Remove) {
  $body = @{ env = @{ $Name = $null } } | ConvertTo-Json -Depth 5 -Compress
} else {
  $secure = Read-Host ("Value for $Name (hidden)") -AsSecureString
  $value = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
  if ($value -notmatch $Shapes[$Name]) {
    $value = $null
    throw "That does not look like a valid $Name (plain ASCII, expected shape). Nothing was sent."
  }
  $body = @{ env = @{ $Name = @{ type = 'secret_text'; text = $value } } } | ConvertTo-Json -Depth 5 -Compress
  $value = $null
}
Invoke-RestMethod -Method Patch -Uri $Url -Headers $headers -ContentType 'application/merge-patch+json' -Body $body | Out-Null
$body = $null

$after = Invoke-RestMethod -Uri $Url -Headers $headers
Show-State $after 'After:'
Write-Host $(if ($Remove) { "Done. $Name was removed." } else { "Done. Only $Name was added." })
