# Sandbox window helper (PREVIEW ONLY). Run in YOUR OWN PowerShell; nothing is sent to chat.
#   pwsh -File window-tools.ps1
# It asks for the Preview admin password (hidden) and keeps download links only in memory,
# under names you choose. It prints status codes and a fixed list of non-secret fields.
# It refuses any host other than the Preview below. Download links are never printed.
$ErrorActionPreference = 'Stop'
$Base = 'https://feature-digital-checkout-preparation-amit-photos-paypal-sandbox.erez-family.workers.dev'
Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(60)

$secure = Read-Host 'Preview admin password (hidden)' -AsSecureString
$password = [System.Net.NetworkCredential]::new('', $secure).Password
$links = @{}

function Resolve-Link([string]$raw) {
  $raw = $raw.Trim()
  # a link copied from the mail: https://<preview host>/checkout/download/#t=<token>
  if ($raw -match '^https://([^/]+)/checkout/download/#t=([0-9a-fA-F-]{36})') {
    if ($Matches[1] -ne ([Uri]$Base).Host) { throw 'Not the Preview host - refusing.' }
    return $Base + '/api/download/' + $Matches[2]
  }
  if ($raw.StartsWith('/api/download/')) { return $Base + $raw }
  $u = [Uri]$raw
  if ($u.Scheme -ne 'https' -or $u.Host -ne ([Uri]$Base).Host -or -not $u.AbsolutePath.StartsWith('/api/download/')) { throw 'Not a download link on the Preview host - refusing.' }
  return $u.GetLeftPart([UriPartial]::Path)
}
function Send([string]$method, [string]$url, $body, [bool]$admin, [string]$key) {
  $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($method), $url)
  if ($admin) { $req.Headers.Add('X-Admin-Password', $password) }
  if ($key) { $req.Headers.Add('Idempotency-Key', $key) }
  if ($body) { $req.Content = [System.Net.Http.StringContent]::new(($body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json') }
  $res = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  return $res
}
function Show-Json($res, [string[]]$fields) {
  $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  Write-Host ('HTTP ' + [int]$res.StatusCode)
  try { $o = $text | ConvertFrom-Json } catch { return $null }
  foreach ($f in $fields) { if ($null -ne $o.$f) { Write-Host ('  ' + $f + ' = ' + ($o.$f | ConvertTo-Json -Compress -Depth 4)) } }
  return $o
}

Write-Host "Commands: readiness | mail ORDERID KEY | paste NAME | head NAME | get NAME | support ORDERID | reissue ORDERID KEY NAME | review ORDERID KEY release|revoke | quit"
while ($true) {
  $line = Read-Host '>'
  if (-not $line) { continue }
  $p = $line.Trim() -split '\s+'
  try {
    switch ($p[0]) {
      'quit' { break }
      'paste' {
        $s = Read-Host 'Paste the download link (hidden)' -AsSecureString
        $links[$p[1]] = Resolve-Link ([System.Net.NetworkCredential]::new('', $s).Password)
        Write-Host ('saved as ' + $p[1])
      }
      'head' {
        $res = Send 'HEAD' $links[$p[1]] $null $false $null
        Write-Host ('HEAD ' + $p[1] + ' -> HTTP ' + [int]$res.StatusCode + '  type=' + $res.Content.Headers.ContentType)
        $res.Dispose()
      }
      'get' {
        $res = Send 'GET' $links[$p[1]] $null $false $null
        $bytes = 0
        if ([int]$res.StatusCode -eq 200) { $bytes = $res.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult().Length }
        else { Write-Host ('  body: ' + $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()) }
        Write-Host ('GET ' + $p[1] + ' -> HTTP ' + [int]$res.StatusCode + '  bytes=' + $bytes)
        $res.Dispose()
      }
      'readiness' {
        $res = Send 'GET' ($Base + '/api/admin/paypal/live-readiness') $null $true $null
        $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        Write-Host ('HTTP ' + [int]$res.StatusCode)
        Write-Host $text
      }
      'mail' {
        $res = Send 'POST' ($Base + '/api/admin/paypal/resend-link-email') @{ paypalOrderId = $p[1]; reason = 'sandbox mail test' } $true $p[2]
        $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $o = $text | ConvertFrom-Json
        Write-Host ('HTTP ' + [int]$res.StatusCode + '  ok=' + $o.ok + '  status=' + $o.status + '  reason=' + $o.reason + '  replayed=' + $o.replayed + '  test=' + $o.test)
      }
      'support' {
        $res = Send 'GET' ($Base + '/api/admin/paypal/order?paypalOrderId=' + $p[1]) $null $true $null
        $o = Show-Json $res @('error','status','afterSaleState','disputeOpen','refundedMinor','amountMinor')
        foreach ($a in @($o.actions)) { Write-Host ('  action: ' + $a.action + ' / ' + $a.status + ' / ' + $a.reason + ' / ' + $a.amount_minor) }
      }
      'reissue' {
        $res = Send 'POST' ($Base + '/api/admin/paypal/reissue') @{ paypalOrderId = $p[1]; reason = 'sandbox window test' } $true $p[2]
        $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $o = $text | ConvertFrom-Json
        Write-Host ('HTTP ' + [int]$res.StatusCode + '  ok=' + $o.ok + '  error=' + $o.error + '  reason=' + $o.reason + '  replayed=' + $o.replayed + '  used=' + $o.reissuesUsed + '  remaining=' + $o.reissuesRemaining)
        if ($o.url -and $p[3]) { $links[$p[3]] = $Base + $o.url; Write-Host ('  new link kept in memory as ' + $p[3] + ' (not printed)') }
      }
      'review' {
        $res = Send 'POST' ($Base + '/api/admin/paypal/after-sale-review') @{ paypalOrderId = $p[1]; decision = $p[3]; reason = 'sandbox window test' } $true $p[2]
        Show-Json $res @('ok','error','state','replayed','revokedLinks') | Out-Null
      }
      default { Write-Host 'unknown command' }
    }
  } catch { Write-Host ('error: ' + $_.Exception.Message) }
  if ($p[0] -eq 'quit') { break }
}
$password = $null
