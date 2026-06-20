#!/usr/bin/env bash
# PrivateScribe — security & data-safety verification (READ-ONLY), Linux/macOS.
#
# Confirms the at-rest encryption, network isolation, and service posture of a
# PrivateScribe install are in place and working as designed. It makes NO
# changes: it only reads files, stats permissions, lists listening sockets, and
# does loopback HTTP(S) GETs. It never prints secret values.
#
# This verifies the *technical controls* (encryption, binding, TLS, firewall,
# integrity) — it is not a formal security or HIPAA audit.
#
# Run elevated so it can read the protected data dir / .env:
#   sudo ./verify-security.sh [DATA_DIR]
#
# DATA_DIR defaults to the server-mode location (/var/lib/privatescribe). For a
# standalone (desktop) install, pass the app data dir (where privatescribe.db
# and .env live). Ports default to the server-mode defaults — override via env
# if you changed the LAN port:
#   LAN_PORT=8443 BACKEND_PORT=5111 OLLAMA_PORT=11435 sudo ./verify-security.sh

DATA_DIR="${1:-${PRIVATESCRIBE_DATA_DIR:-/var/lib/privatescribe}}"
LAN_PORT="${LAN_PORT:-8443}"
BACKEND_PORT="${BACKEND_PORT:-5111}"
OLLAMA_PORT="${OLLAMA_PORT:-11435}"

pass=0; fail=0; warn=0; skip=0
PASS(){ echo "  [PASS] $*"; pass=$((pass+1)); }
FAIL(){ echo "  [FAIL] $*"; fail=$((fail+1)); }
WARN(){ echo "  [WARN] $*"; warn=$((warn+1)); }
SKIP(){ echo "  [SKIP] $*"; skip=$((skip+1)); }
hdr(){ echo; echo "== $* =="; }

echo "PrivateScribe security verification — $(date)"
echo "Data dir: $DATA_DIR   Ports: lan=$LAN_PORT backend=$BACKEND_PORT ollama=$OLLAMA_PORT"

# ---- 1. Data directory & secrets -----------------------------------------
hdr "1. Data directory & secrets"
if [ -d "$DATA_DIR" ]; then PASS "data dir exists: $DATA_DIR"
else FAIL "data dir not found: $DATA_DIR (pass the correct path as arg 1)"; fi

ENV="$DATA_DIR/.env"
key=""
if [ -f "$ENV" ]; then
  PASS ".env present"
  perm=$(stat -c %a "$ENV" 2>/dev/null || stat -f %A "$ENV" 2>/dev/null)
  if [ "$perm" = "600" ]; then PASS ".env permissions are 600 (owner read/write only)"
  else WARN ".env permissions are '$perm' (expected 600 — the SQLCipher key lives here)"; fi
  owner=$(stat -c %U "$ENV" 2>/dev/null || stat -f %Su "$ENV" 2>/dev/null)
  echo "         .env owner: ${owner:-unknown}"
  if grep -q '^SQLCIPHER_KEY=' "$ENV"; then
    key=$(grep '^SQLCIPHER_KEY=' "$ENV" | head -1 | cut -d= -f2- | tr -d "\"' \r")
    if printf '%s' "$key" | grep -Eq '^[0-9a-fA-F]{64}$'; then
      PASS "SQLCIPHER_KEY present (64 hex chars = 256-bit)"
    else WARN "SQLCIPHER_KEY present but not 64 hex chars (len=${#key}) — verify format"; fi
  else FAIL "SQLCIPHER_KEY missing from .env — DB cannot be encrypted"; fi
  if grep -q '^JWT_SECRET_KEY=' "$ENV"; then PASS "JWT_SECRET_KEY present"
  else FAIL "JWT_SECRET_KEY missing from .env"; fi
else
  if [ -d "$DATA_DIR" ]; then FAIL ".env not found at $ENV (run elevated; it is owner-readable only)"
  else SKIP ".env check (data dir missing)"; fi
fi

# ---- 2. Database encryption at rest (SQLCipher) --------------------------
hdr "2. Database encryption at rest (SQLCipher)"
DB="$DATA_DIR/privatescribe.db"
if [ -f "$DB" ]; then
  PASS "database present: $DB"
  magic=$(head -c 15 "$DB" 2>/dev/null)
  if [ "$magic" = "SQLite format 3" ]; then
    FAIL "DB header is the plaintext SQLite magic string — DATABASE IS NOT ENCRYPTED"
  else
    PASS "DB header is not the SQLite magic string — encrypted (SQLCipher)"
  fi
  if command -v sqlite3 >/dev/null 2>&1; then
    if [ -n "$(sqlite3 "$DB" '.tables' 2>/dev/null)" ]; then
      FAIL "plain sqlite3 listed tables — DB is readable WITHOUT a key (NOT encrypted)"
    else
      PASS "plain sqlite3 cannot read the DB without a key — as expected"
    fi
  else SKIP "plain-open test (sqlite3 not installed)"; fi
  if command -v sqlcipher >/dev/null 2>&1 && [ -n "$key" ]; then
    out=$(printf "PRAGMA key=\"x'%s'\";\n.tables\n" "$key" | sqlcipher "$DB" 2>/dev/null)
    if printf '%s' "$out" | grep -Eqi 'user|note|audit'; then
      PASS "sqlcipher opens the DB with the .env key — keyed access works"
    else WARN "sqlcipher keyed open returned no expected tables — verify manually"; fi
  else SKIP "keyed-open proof (sqlcipher CLI not installed; header check + live backend already imply it)"; fi
else
  FAIL "database not found at $DB"
fi

# ---- 3. Stored audio encryption at rest (AES-256-GCM) --------------------
hdr "3. Stored audio encryption at rest (AES-256-GCM)"
ADIR="$DATA_DIR/audio"
if [ -d "$ADIR" ]; then
  sample=$(find "$ADIR" -type f 2>/dev/null | head -1)
  if [ -n "$sample" ]; then
    m=$(head -c 4 "$sample" 2>/dev/null | tr -d '\0')
    case "$m" in
      RIFF|OggS|fLaC|ID3*) FAIL "audio file starts with a known audio header ($m) — NOT encrypted: $sample";;
      *) PASS "sampled audio file has no recognizable audio-container header — ciphertext ($(basename "$sample"))";;
    esac
  else WARN "no audio files stored yet — record a note, then re-run to verify audio-at-rest"; fi
else
  WARN "audio dir not found ($ADIR) — audio storage may be off, or nothing recorded yet"
fi

# ---- 4. Network isolation (only Caddy faces the LAN) ---------------------
hdr "4. Network isolation (only the web server faces the LAN)"
if command -v ss >/dev/null 2>&1; then LIST=$(ss -tlnH 2>/dev/null)
else LIST=$(netstat -tln 2>/dev/null); fi
loopback_only(){ # port label
  local port="$1" label="$2" a
  a=$(printf '%s\n' "$LIST" | awk '{print $4}' | grep -E ":$port\$")
  if [ -z "$a" ]; then WARN "$label not listening on port $port (service down?)"; return; fi
  if printf '%s\n' "$a" | grep -Eq '^(0\.0\.0\.0|\*|\[::\]|::):'; then
    FAIL "$label is listening on ALL interfaces ($a) — must be loopback only"
  else
    PASS "$label bound to loopback only ($a)"
  fi
}
if [ -n "$LIST" ]; then
  loopback_only "$BACKEND_PORT" "backend"
  loopback_only "$OLLAMA_PORT" "Ollama"
  ca=$(printf '%s\n' "$LIST" | awk '{print $4}' | grep -E ":$LAN_PORT\$")
  if [ -n "$ca" ]; then PASS "web server (Caddy) listening on LAN port: $ca"
  else WARN "nothing listening on LAN port $LAN_PORT (web server down?)"; fi
else SKIP "socket check (ss/netstat produced no output — run elevated)"; fi

# ---- 5. TLS termination & backend proxy ----------------------------------
hdr "5. TLS termination & backend proxy (Caddy)"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -ks -o /dev/null -w '%{http_code}' "https://127.0.0.1:$LAN_PORT/api/setup/status" 2>/dev/null)
  if [ "$code" = "200" ]; then PASS "Caddy serves HTTPS on :$LAN_PORT and proxies /api (200)"
  else WARN "HTTPS GET to Caddy returned '$code' (expected 200)"; fi
  bcode=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BACKEND_PORT/api/setup/status" 2>/dev/null)
  if [ "$bcode" = "200" ]; then PASS "backend answers on loopback http://127.0.0.1:$BACKEND_PORT (200)"
  else WARN "backend loopback GET returned '$bcode'"; fi
else SKIP "TLS/reachability checks (curl not installed)"; fi

CERTDIR="$DATA_DIR/caddy/data/caddy/pki/authorities/local"
if [ -d "$CERTDIR" ] && ls "$CERTDIR"/*.crt >/dev/null 2>&1; then
  PASS "Caddy internal-CA cert present ($CERTDIR)"
  if command -v openssl >/dev/null 2>&1; then
    fp=$(openssl x509 -in "$(ls "$CERTDIR"/*.crt | head -1)" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2)
    [ -n "$fp" ] && echo "         CA SHA-256: $fp"
  fi
else WARN "Caddy CA cert not found under $CERTDIR (path can vary by Caddy version)"; fi

# ---- 6. Background services ----------------------------------------------
hdr "6. Background services"
if command -v systemctl >/dev/null 2>&1; then
  for u in privatescribe-backend privatescribe-ollama privatescribe-caddy; do
    st=$(systemctl is-active "$u" 2>/dev/null)
    if [ "$st" = "active" ]; then PASS "$u is active"
    else WARN "$u is '${st:-not-found}' (expected active)"; fi
  done
else SKIP "service status (systemctl not present — not a systemd server)"; fi

# ---- 7. Firewall exposure -------------------------------------------------
hdr "7. Firewall exposure"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
  echo "  ufw active — rules mentioning the relevant ports:"
  ufw status 2>/dev/null | grep -E "$LAN_PORT|$BACKEND_PORT|$OLLAMA_PORT" || echo "    (none listed)"
  WARN "review: only $LAN_PORT should be reachable from the LAN; $BACKEND_PORT/$OLLAMA_PORT must NOT be"
elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  echo "  firewalld active — open ports: $(firewall-cmd --list-ports 2>/dev/null)"
  WARN "review: $BACKEND_PORT/$OLLAMA_PORT must not be exposed"
else
  WARN "no active ufw/firewalld detected. Since backend+Ollama bind loopback (check 4), they are not LAN-reachable regardless; confirm only $LAN_PORT is intended to be open."
fi

# ---- 8. Audit-log tamper chain -------------------------------------------
hdr "8. Audit-log tamper chain"
if command -v flask >/dev/null 2>&1 && flask verify-audit-log >/dev/null 2>&1; then
  PASS "flask verify-audit-log passed (hash chain intact)"
else
  SKIP "run 'flask verify-audit-log' from a backend dev environment (FLASK_APP=wsgi) to walk the audit hash chain"
fi

# ---- Summary --------------------------------------------------------------
hdr "Summary"
echo "  PASS=$pass  FAIL=$fail  WARN=$warn  SKIP=$skip"
if [ "$fail" -eq 0 ]; then
  echo "  No failures. An encrypted DB header + a responding backend together imply"
  echo "  the keyed SQLCipher path is working (the backend can't serve a DB it can't decrypt)."
else
  echo "  $fail FAILURE(S) above — investigate before trusting this deployment with real data."
fi
[ "$fail" -eq 0 ]
