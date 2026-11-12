# Test: Kommen Bestellungen über die offizielle Whatnot-API schnell genug und mit Käufer und Artikel an?
# Fragt alle 3 Sekunden die Bestellungen ab und zeigt nur neue an. Speichert nichts, schickt nichts ans Board.
# Aufruf: powershell -File tools\whatnot-api-test.ps1   (Token mit read:orders, read:customers, read:shows)
# Beenden: Strg+C
$ErrorActionPreference = 'Stop'
$api = 'https://api.whatnot.com/seller-api/rest/v2'

$token = $env:WHATNOT_TOKEN
if (-not $token) {
  $sec = Read-Host 'Whatnot-Token einfügen (wird nicht angezeigt und nicht gespeichert)' -AsSecureString
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
$headers = @{ Authorization = "Bearer $($token.Trim())" }

function Get-Api($path) {
  try {
    return Invoke-RestMethod -Uri "$api$path" -Headers $headers -TimeoutSec 15
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 401) { throw 'Token ungültig oder abgelaufen (401).' }
    if ($code -eq 403) { throw "Keine Berechtigung für $path (403). Fehlt ein Recht am Token, z. B. read:orders, read:customers oder read:shows?" }
    if ($code -eq 429) { Write-Host 'Zu viele Anfragen (429), warte 5 s ...' -ForegroundColor Yellow; Start-Sleep 5; return $null }
    Write-Host "Fehler bei ${path}: $($_.Exception.Message)" -ForegroundColor Red
    return $null
  }
}
function Format-Money($m) { if ($m) { "$($m.amount) $($m.currency)" } else { '?' } }

# Laufende Show
$shows = Get-Api '/shows?status=live&limit=5'
$liveIds = @($shows.data | ForEach-Object { $_.id })
if ($liveIds.Count) {
  $shows.data | ForEach-Object { Write-Host "Live-Show: $($_.title)  (ID $($_.id))" -ForegroundColor Cyan }
} else {
  Write-Host 'Keine Show ist gerade live. Es werden trotzdem alle neuen Bestellungen angezeigt.' -ForegroundColor Yellow
}

# Bisherige Bestellungen merken, nur neue anzeigen
$seen = @{}
$first = Get-Api '/orders?limit=50'
$first.data | ForEach-Object { $seen[$_.id] = $true }
Write-Host "$($seen.Count) bisherige Bestellungen übersprungen. Warte auf neue (Strg+C beendet) ..." -ForegroundColor Cyan

while ($true) {
  Start-Sleep -Seconds 3
  $page = Get-Api '/orders?limit=20'
  if (-not $page) { continue }
  # Älteste zuerst ausgeben
  $new = @($page.data | Where-Object { -not $seen.ContainsKey($_.id) })
  [array]::Reverse($new)
  foreach ($o in $new) {
    $seen[$o.id] = $true
    $now = [DateTime]::UtcNow
    $delay = if ($o.created_at) { [int]($now - ([DateTime]::Parse($o.created_at)).ToUniversalTime()).TotalSeconds } else { '?' }
    $items = Get-Api "/orders/$($o.id)/items"
    $titles = @($items.data | ForEach-Object {
      $t = if ($_.purchased_item) { $_.purchased_item.title } else { '(kein Titel)' }
      "$($_.quantity)x $t zu $(Format-Money $_.unit_price)"
    }) -join ' | '
    $inShow = if ($o.show_id -and $liveIds -contains $o.show_id) { 'diese Show' } elseif ($o.show_id) { "andere Show $($o.show_id)" } else { 'ohne Show' }
    $buyer = if ($o.buyer) { $o.buyer.username } else { '(kein Käufer, Recht read:customers fehlt?)' }
    Write-Host ''
    Write-Host ("{0:HH:mm:ss}  {1}  Käufer: {2}  Gesamt: {3}" -f (Get-Date), $o.transaction_type, $buyer, (Format-Money $o.amounts.total)) -ForegroundColor Green
    Write-Host "          Artikel: $titles"
    Write-Host "          Bestellt $($o.created_at), angekommen nach $delay s, $inShow, Status $($o.status)"
  }
}
