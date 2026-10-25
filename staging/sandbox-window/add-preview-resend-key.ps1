# Adds RESEND_API_KEY as a SECRET to the Preview of PR #155 ONLY
# (Worker amit-photos-paypal-sandbox, preview for feature/digital-checkout-preparation-2026-10-13).
#   pwsh -File add-preview-resend-key.ps1 -CheckOnly   # read-only: no key is asked for or sent
#   pwsh -File add-preview-resend-key.ps1              # asks for the key (hidden) and adds it
# The key is read with a hidden prompt, lives only in memory, is sent once over HTTPS to the
# Cloudflare API, is never written to a file, never printed, and is not part of the command line,
# so shell history does not contain it. The script changes nothing except that one secret and
# refuses to run unless both payment flags of this Preview are "false".
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$Account = '439cc74123631d21ff905817aca9785d'
$Worker  = 'amit-photos-paypal-sandbox'
$Preview = '8ef9ae2781484d48b596b3da8815f6f9'
$Url = "https://api.cloudflare.com/client/v4/accounts/$Account/workers/workers/$Worker/previews/$Preview/deployments/latest"

# Cloudflare login token that wrangler already holds (kept in memory, never printed).
$lines = & npx -y wrangler@4.149.0 auth token 2>$null
$token = ($lines | ForEach-Object { "$_".Trim() } | Where-Object { $_ -match '^[A-Za-z0-9_.-]{20,}$' } | Select-Object -Last 1)
if (-not $token) { throw 'No wrangler login found. Run "npx wrangler login" first, then run this script again.' }
$headers = @{ Authorization = "Bearer $token" }

function Show-State($deployment, [string]$title) {
  $env = $deployment.result.env
  Write-Host $title
  Write-Host ('  deployment id        : ' + $deployment.result.id)
  Write-Host ('  code tag             : ' + $deployment.result.annotations.'workers/tag')
  Write-Host ('  PAYMENTS_ENABLED     : ' + $env.PAYMENTS_ENABLED.text)
  Write-Host ('  DIGITAL_PAYPAL_ENABLED: ' + $env.DIGITAL_PAYPAL_ENABLED.text)
  Write-Host ('  RESEND_API_KEY       : ' + $(if ($env.RESEND_API_KEY) { 'present (' + $env.RESEND_API_KEY.type + ')' } else { 'absent' }))
  Write-Host ('  DOWNLOAD_EMAIL_ENABLED: ' + $(if ($env.DOWNLOAD_EMAIL_ENABLED) { $env.DOWNLOAD_EMAIL_ENABLED.text } else { 'absent' }))
}

$before = Invoke-RestMethod -Uri $Url -Headers $headers
Show-State $before 'Before:'
if ($before.result.env.PAYMENTS_ENABLED.text -ne 'false' -or $before.result.env.DIGITAL_PAYPAL_ENABLED.text -ne 'false') {
  throw 'Refusing: a payment flag of this Preview is not "false".'
}
if ($CheckOnly) { Write-Host 'Check only: nothing was changed.'; return }

$secure = Read-Host 'Resend API key for the Preview (hidden)' -AsSecureString
$key = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if ($key -notmatch '^re_[A-Za-z0-9_\-]{16,}$') {
  $key = $null
  throw 'That does not look like a Resend API key (it should start with "re_" and contain only plain ASCII letters, digits, "_" or "-"). Nothing was sent.'
}
$body = @{ env = @{ RESEND_API_KEY = @{ type = 'secret_text'; text = $key } } } | ConvertTo-Json -Depth 5 -Compress
$key = $null
Invoke-RestMethod -Method Patch -Uri $Url -Headers $headers -ContentType 'application/merge-patch+json' -Body $body | Out-Null
$body = $null

$after = Invoke-RestMethod -Uri $Url -Headers $headers
Show-State $after 'After:'
if (-not $after.result.env.RESEND_API_KEY) { throw 'The secret does not appear on the Preview - tell Claude.' }
Write-Host 'Done. Only RESEND_API_KEY was added. Mail stays off until DOWNLOAD_EMAIL_ENABLED is set, which needs its own approval.'
