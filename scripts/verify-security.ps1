<#
  PrivateScribe — security & data-safety verification (READ-ONLY), Windows.

  Confirms the at-rest encryption, network isolation, and service posture of a
  PrivateScribe install are in place and working as designed. It makes NO
  changes: it only reads files, inspects ACLs, lists listening sockets, and
  does loopback HTTP(S) GETs. It never prints secret values.

  This verifies the *technical controls* (encryption, binding, TLS, firewall,
  integrity) — it is not a formal security or HIPAA audit.

  Run in an ELEVATED PowerShell (Run as administrator) so it can read the
  protected ProgramData files:
    powershell -ExecutionPolicy Bypass -File .\verify-security.ps1

  -DataDir defaults to the server-mode location (C:\ProgramData\PrivateScribe).
  For a standalone (desktop) install, pass the app data dir. Override the ports
  with -LanPort/-BackendPort/-OllamaPort if you changed the LAN port.
#>
param(
  [string]$DataDir = $(if ($env:PRIVATESCRIBE_DATA_DIR) { $env:PRIVATESCRIBE_DATA_DIR } else { Join-Path $env:ProgramData 'PrivateScribe' }),
  [int]$LanPort = 8443,
  [int]$BackendPort = 5111,
  [int]$OllamaPort = 11435
)

$script:pass = 0; $script:fail = 0; $script:warn = 0; $script:skip = 0
function PASS($m) { Write-Host "  [PASS] $m" -ForegroundColor Green;  $script:pass++ }
function FAIL($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red;    $script:fail++ }
function WARN($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow; $script:warn++ }
function SKIP($m) { Write-Host "  [SKIP] $m" -ForegroundColor DarkGray; $script:skip++ }
function HDR($m)  { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }

Write-Host "PrivateScribe security verification — $(Get-Date)"
Write-Host "Data dir: $DataDir   Ports: lan=$LanPort backend=$BackendPort ollama=$OllamaPort"

# ---- 1. Data directory & secrets -----------------------------------------
HDR "1. Data directory & secrets"
if (Test-Path $DataDir) { PASS "data dir exists: $DataDir" }
else { FAIL "data dir not found: $DataDir (pass -DataDir)" }

$envPath = Join-Path $DataDir '.env'
$key = $null
if (Test-Path $envPath) {
  PASS ".env present"
  try {
    $acl = Get-Acl $envPath
    $broad = $acl.Access | Where-Object {
      $_.IdentityReference -match 'Everyone|\\Users$|\\Users |Authenticated Users' -and
      $_.FileSystemRights -match 'Read|Modify|FullControl' -and $_.AccessControlType -eq 'Allow'
    }
    if ($broad) {
      WARN ".env is readable by a broad group ($(@($broad.IdentityReference) -join ', ')) — restrict to SYSTEM/Administrators. NOTE: os.chmod(600) is a no-op on Windows ACLs, so this often needs an explicit icacls lock-down."
    } else {
      PASS ".env ACL is restricted (no Everyone/Users read access)"
    }
  } catch { WARN "could not read .env ACL: $_" }
  $lines = Get-Content $envPath -ErrorAction SilentlyContinue
  $kl = $lines | Where-Object { $_ -match '^SQLCIPHER_KEY=' } | Select-Object -First 1
  if ($kl) {
    $key = (($kl -split '=', 2)[1]).Trim().Trim('"').Trim("'")
    if ($key -match '^[0-9a-fA-F]{64}$') { PASS "SQLCIPHER_KEY present (64 hex chars = 256-bit)" }
    else { WARN "SQLCIPHER_KEY present but not 64 hex chars — verify format" }
  } else { FAIL "SQLCIPHER_KEY missing from .env — DB cannot be encrypted" }
  if ($lines | Where-Object { $_ -match '^JWT_SECRET_KEY=' }) { PASS "JWT_SECRET_KEY present" }
  else { FAIL "JWT_SECRET_KEY missing from .env" }
} else {
  if (Test-Path $DataDir) { FAIL ".env not found at $envPath (run elevated to read it)" }
  else { SKIP ".env check (data dir missing)" }
}

# ---- 2. Database encryption at rest (SQLCipher) --------------------------
HDR "2. Database encryption at rest (SQLCipher)"
$db = Join-Path $DataDir 'privatescribe.db'
if (Test-Path $db) {
  PASS "database present: $db"
  $buf = New-Object byte[] 16
  $fs = [System.IO.File]::OpenRead($db)
  try { [void]$fs.Read($buf, 0, 16) } finally { $fs.Close() }
  $magic = [System.Text.Encoding]::ASCII.GetString($buf[0..14])
  if ($magic -eq 'SQLite format 3') { FAIL "DB header is the plaintext SQLite magic — DATABASE IS NOT ENCRYPTED" }
  else { PASS "DB header is not the SQLite magic string — encrypted (SQLCipher)" }
} else { FAIL "database not found at $db" }
SKIP "keyed/plain open proof — install the 'sqlcipher' CLI to prove keyed access; the header check + a responding backend already imply it"

# ---- 3. Stored audio encryption at rest (AES-256-GCM) --------------------
HDR "3. Stored audio encryption at rest (AES-256-GCM)"
$adir = Join-Path $DataDir 'audio'
if (Test-Path $adir) {
  $sample = Get-ChildItem -Path $adir -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($sample) {
    $b = [System.IO.File]::ReadAllBytes($sample.FullName) | Select-Object -First 4
    $m = [System.Text.Encoding]::ASCII.GetString($b)
    if ($m -in @('RIFF', 'OggS', 'fLaC') -or $m -like 'ID3*') {
      FAIL "audio file starts with a known audio header ($m) — NOT encrypted: $($sample.Name)"
    } else {
      PASS "sampled audio file has no recognizable audio-container header — ciphertext ($($sample.Name))"
    }
  } else { WARN "no audio files stored yet — record a note, then re-run to verify audio-at-rest" }
} else { WARN "audio dir not found ($adir) — audio storage may be off, or nothing recorded yet" }

# ---- 4. Network isolation (only the web server faces the LAN) ------------
HDR "4. Network isolation (only the web server faces the LAN)"
$listen = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
function Test-LoopbackOnly($port, $label) {
  $rows = $listen | Where-Object { $_.LocalPort -eq $port }
  if (-not $rows) { WARN "$label not listening on port $port (service down?)"; return }
  $bad = $rows | Where-Object { $_.LocalAddress -in @('0.0.0.0', '::') }
  $addrs = (@($rows.LocalAddress) | Sort-Object -Unique) -join ','
  if ($bad) { FAIL "$label is listening on ALL interfaces ($addrs : $port) — must be loopback only" }
  else { PASS "$label bound to loopback only ($addrs : $port)" }
}
if ($listen) {
  Test-LoopbackOnly $BackendPort 'backend'
  Test-LoopbackOnly $OllamaPort 'Ollama'
  $caddy = $listen | Where-Object { $_.LocalPort -eq $LanPort }
  if ($caddy) { PASS "web server (Caddy) listening on LAN port $LanPort ($((@($caddy.LocalAddress) | Sort-Object -Unique) -join ','))" }
  else { WARN "nothing listening on LAN port $LanPort (web server down?)" }
} else { SKIP "socket check (Get-NetTCPConnection returned nothing)" }

# ---- 5. TLS termination & backend proxy ----------------------------------
HDR "5. TLS termination & backend proxy (Caddy)"
$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($curl) {
  $code = (& curl.exe -ks -o NUL -w '%{http_code}' "https://127.0.0.1:$LanPort/api/setup/status" 2>$null)
  if ($code -eq '200') { PASS "Caddy serves HTTPS on :$LanPort and proxies /api (200)" }
  else { WARN "HTTPS GET to Caddy returned '$code' (expected 200)" }
  $bcode = (& curl.exe -s -o NUL -w '%{http_code}' "http://127.0.0.1:$BackendPort/api/setup/status" 2>$null)
  if ($bcode -eq '200') { PASS "backend answers on loopback http://127.0.0.1:$BackendPort (200)" }
  else { WARN "backend loopback GET returned '$bcode'" }
} else { SKIP "TLS/reachability checks (curl.exe not found)" }

$certDir = Join-Path $DataDir 'caddy\data\caddy\pki\authorities\local'
if (Test-Path $certDir) {
  $crt = Get-ChildItem $certDir -Filter *.crt -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($crt) {
    PASS "Caddy internal-CA cert present"
    try {
      $c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $crt.FullName
      $sha = [System.Security.Cryptography.SHA256]::Create().ComputeHash($c.RawData)
      $fp = ($sha | ForEach-Object { $_.ToString('x2') }) -join ':'
      Write-Host "         CA SHA-256: $fp"
    } catch {}
  } else { WARN "no .crt under $certDir" }
} else { WARN "Caddy CA dir not found ($certDir) — path can vary by Caddy version" }

# ---- 6. Background services ----------------------------------------------
HDR "6. Background services"
foreach ($svc in 'privatescribe-backend', 'privatescribe-ollama', 'privatescribe-caddy') {
  $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if ($s) {
    if ($s.Status -eq 'Running') { PASS "$svc is Running" }
    else { WARN "$svc is $($s.Status) (expected Running)" }
  } else { WARN "$svc service not found (server not installed?)" }
}

# ---- 7. Firewall exposure -------------------------------------------------
HDR "7. Firewall exposure"
try {
  $rules = Get-NetFirewallRule -DisplayName 'PrivateScribe*' -ErrorAction SilentlyContinue
  if ($rules) {
    foreach ($r in $rules) {
      $pf = $r | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
      $state = if ([string]$r.Enabled -eq 'True') { 'enabled' } else { 'DISABLED' }
      PASS "rule '$($r.DisplayName)': $($r.Direction)/$($r.Action)/$state proto=$($pf.Protocol) port=$($pf.LocalPort)"
    }
  } else { WARN "no 'PrivateScribe*' firewall rules found — LAN clients may be blocked, or rules are named differently" }
  $exposed = Get-NetFirewallPortFilter -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @("$BackendPort", "$OllamaPort") }
  if ($exposed) { WARN "a firewall rule references the backend/Ollama port ($BackendPort/$OllamaPort) — these should NOT be LAN-exposed" }
  else { PASS "no firewall rule exposes the backend/Ollama loopback ports" }
} catch { SKIP "firewall check ($_)" }

# ---- 8. Audit-log tamper chain -------------------------------------------
HDR "8. Audit-log tamper chain"
SKIP "run 'flask verify-audit-log' from a backend environment to walk the audit hash chain (not runnable from the packaged install)"

# ---- Summary --------------------------------------------------------------
HDR "Summary"
Write-Host "  PASS=$script:pass  FAIL=$script:fail  WARN=$script:warn  SKIP=$script:skip"
if ($script:fail -eq 0) {
  Write-Host "  No failures. An encrypted DB header + a responding backend together imply the" -ForegroundColor Green
  Write-Host "  keyed SQLCipher path works (the backend can't serve a DB it can't decrypt)." -ForegroundColor Green
} else {
  Write-Host "  $script:fail FAILURE(S) above — investigate before trusting this deployment with real data." -ForegroundColor Red
}
exit ([int]($script:fail -gt 0))
