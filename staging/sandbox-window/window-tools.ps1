# Sandbox window helper (PREVIEW ONLY). Run in YOUR OWN PowerShell; nothing is sent to chat.
#   pwsh -File window-tools.ps1
# It asks for the Preview admin password (hidden) and keeps download links only in memory,
# under names you choose. It prints status codes and a fixed list of non-secret fields.
# It refuses any host other than the Preview below. Download links are never printed.
param([switch]$SelfTest)
$ErrorActionPreference = 'Stop'
$Base = 'https://feature-digital-checkout-preparation-amit-photos-paypal-sandbox.erez-family.workers.dev'

# The admin password travels in an HTTP header, and HTTP headers can only carry plain ASCII.
# A password typed with a Hebrew keyboard layout, or pasted with invisible direction marks, makes
# .NET fail with "Request headers must contain only ASCII characters". This checks the password
# BEFORE it is used and explains the problem without ever printing the password itself.
function Normalize-AdminPassword([string]$raw) {
  $invisible = '[​-‏‪-‮⁠⁦-⁩﻿ ]'
  $removed = ([regex]::Matches($raw, $invisible)).Count
  $clean = ([regex]::Replace($raw, $invisible, '')).Trim()
  $nonAscii = ([regex]::Matches($clean, '[^ -~]')).Count
  [pscustomobject]@{ Value = $clean; Removed = $removed; NonAscii = $nonAscii; Empty = ($clean.Length -eq 0) }
}
function Read-AdminPassword {
  for ($try = 1; $try -le 3; $try++) {
    $secure = Read-Host 'Preview admin password (hidden) - type it with the ENGLISH keyboard layout' -AsSecureString
    $r = Normalize-AdminPassword ([System.Net.NetworkCredential]::new('', $secure).Password)
    if ($r.Removed -gt 0) { Write-Host ("note: removed $($r.Removed) invisible character(s) (direction marks / spaces) that were pasted with the password") }
    if ($r.Empty) { Write-Host 'error: empty password.'; continue }
    if ($r.NonAscii -gt 0) {
      Write-Host ("error: the password contains $($r.NonAscii) character(s) that are not plain ASCII (for example Hebrew letters typed with the wrong keyboard layout). " +
        "Switch the keyboard to English and type it again. The password was not sent anywhere.")
      continue
    }
    return $r.Value
  }
  throw 'Could not read a valid ASCII password after 3 tries. If the real password contains non-ASCII characters it cannot be sent in a header; use an ASCII-only password for this tool.'
}

if ($SelfTest) {
  # Self-test with synthetic strings only (no real password involved); prints PASS/FAIL, never a value.
  $cases = @(
    @{ Name = 'plain ascii';          In = 'Abc-123_xyz';                              Value = 'Abc-123_xyz'; Removed = 0; NonAscii = 0 },
    @{ Name = 'trailing space';       In = 'Abc-123 ';                                  Value = 'Abc-123';     Removed = 0; NonAscii = 0 },
    @{ Name = 'RTL mark pasted';      In = ('Abc' + [char]0x200F + '123');              Value = 'Abc123';      Removed = 1; NonAscii = 0 },
    @{ Name = 'BOM + zero width';     In = ([char]0xFEFF + 'Abc' + [char]0x200B + '1'); Value = 'Abc1';        Removed = 2; NonAscii = 0 },
    @{ Name = 'hebrew letters';       In = ('Abc' + [char]0x05D0 + [char]0x05D1);       Value = $null;         Removed = 0; NonAscii = 2 },
    @{ Name = 'non-breaking space';   In = ('Abc' + [char]0x00A0 + '1');                Value = 'Abc1';        Removed = 1; NonAscii = 0 },
    @{ Name = 'accented letter';      In = ('Abc' + [char]0x00E9);                      Value = $null;         Removed = 0; NonAscii = 1 }
  )
  $failed = 0
  foreach ($c in $cases) {
    $r = Normalize-AdminPassword $c.In
    $ok = ($r.Removed -eq $c.Removed) -and ($r.NonAscii -eq $c.NonAscii) -and (($null -eq $c.Value) -or ($r.Value -ceq $c.Value))
    if (-not $ok) { $failed++ }
    Write-Host ((@('FAIL', 'PASS')[[int]$ok]) + '  ' + $c.Name)
  }
  if ((Normalize-AdminPassword '   ').Empty) { Write-Host 'PASS  whitespace-only is empty' } else { $failed++; Write-Host 'FAIL  whitespace-only is empty' }
  exit $failed
}

Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(60)

$password = Read-AdminPassword
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
  if ($admin) {
    try { $req.Headers.Add('X-Admin-Password', $password) }
    catch { throw 'The admin password cannot be sent as an HTTP header (it must be plain ASCII). Restart the tool and type it with the English keyboard layout.' }
  }
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

Write-Host "Commands: readiness | switch | switch open|closed|frozen KEY [closesAtISO maxOrders photoId,photoId] | testalert KEY | mail ORDERID KEY | paste NAME | head NAME | get NAME | support ORDERID | reissue ORDERID KEY NAME | review ORDERID KEY release|revoke | quit"
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
      'switch' {
        # Only the existing admin route: it validates, enforces the readiness/flag rules and writes the audit row.
        # No database is touched here. "switch" alone is a read.
        if ($p.Count -eq 1) {
          $res = Send 'GET' ($Base + '/api/admin/paypal/switch') $null $true $null
          Show-Json $res @('error','valid','reason','state','effectiveMode','autoClosed','config','note') | Out-Null
        } else {
          $state = $p[1]
          if ($state -notin @('open','closed','frozen')) { throw 'State must be open, closed or frozen.' }
          if ($p.Count -lt 3) { throw 'An idempotency KEY (8-64 letters, digits, - or _) is required.' }
          $body = @{ state = $state; reason = 'switch via window-tools' }
          if ($state -eq 'open') {
            if ($p.Count -lt 4) { throw 'open needs: switch open KEY closesAtISO(UTC, e.g. 2026-10-20T18:00:00Z) [maxOrders] [photoId,photoId]' }
            $body.closesAt = $p[3]
            if ($p.Count -ge 5) { $body.maxOrders = [int]$p[4] }
            if ($p.Count -ge 6) { $body.photoIds = @($p[5] -split ',') }
          }
          $res = Send 'POST' ($Base + '/api/admin/paypal/switch') $body $true $p[2]
          Show-Json $res @('ok','error','replayed','requestedState','currentState','state','effectiveMode','config') | Out-Null
        }
      }
      'testalert' {
        $res = Send 'POST' ($Base + '/api/admin/paypal/test-alert') @{ reason = 'sandbox alert channel test' } $true $p[1]
        $text = $res.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $o = $text | ConvertFrom-Json
        Write-Host ('HTTP ' + [int]$res.StatusCode + '  ok=' + $o.ok + '  status=' + $o.status + '  replayed=' + $o.replayed + '  channels=' + ($o.channels -join '+') + '  error=' + $o.error + $o.reason)
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
  } catch {
    $m = $_.Exception.Message
    if ($m -like '*ASCII*') { $m = 'A value that must be plain ASCII was rejected (the admin password or a pasted value). Restart the tool and use the English keyboard layout.' }
    Write-Host ('error: ' + $m)
  }
  if ($p[0] -eq 'quit') { break }
}
$password = $null
