"""CORS allowlist regression guard.

Proves every route honors the single app-wide allowlist resolved by
`cors_origins()` (deployment mode + PRIVATESCRIBE_CORS_ORIGINS), with no
per-route `@cross_origin` override pinning its own origin. Self-contained —
spins up its own encrypted temp DB and sends a credentialed CORS preflight to
every registered route under each scenario:

  - standalone default        → http://localhost:3000 allowed everywhere
  - standalone + override     → only the configured origin is allowed
  - server, nothing configured → cross-origin denied everywhere

    cd backend && source venv/bin/activate
    python scripts/test_cors_allowlist.py

Exits non-zero if any route disagrees with the allowlist, so it can gate a build.
"""
import os
import re
import secrets
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")

# Self-contained env: isolated data dir + key, no diarization prewarm.
_TMP = tempfile.mkdtemp(prefix="ps-cors-test-")
os.environ["PRIVATESCRIBE_DATA_DIR"] = _TMP
os.environ.setdefault("SQLCIPHER_KEY", secrets.token_hex(32))
os.environ["HF_TOKEN"] = ""

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app

DEV_ORIGIN = "http://localhost:3000"
CUSTOM_ORIGIN = "http://localhost:3001"

_results: list[tuple[str, bool]] = []


def check(label: str, passed: bool) -> None:
    _results.append((label, bool(passed)))
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")


def build_app(mode: str, origins: str):
    # cors_origins() reads the env inside create_app(). Set both explicitly —
    # an empty value (not unset) also stops load_dotenv() from refilling it.
    os.environ["PRIVATESCRIBE_MODE"] = mode
    os.environ["PRIVATESCRIBE_CORS_ORIGINS"] = origins
    return create_app()


def routes(app) -> list[tuple[str, str]]:
    """(method, concrete path) for every non-static route."""
    out = []
    for rule in app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue
        method = sorted(rule.methods - {"HEAD", "OPTIONS"})[0]
        out.append((method, re.sub(r"<[^>]+>", "x", rule.rule)))
    return sorted(out, key=lambda r: r[1])


def allowed_origin(client, method: str, path: str, origin: str):
    """Access-Control-Allow-Origin returned for an authenticated preflight."""
    resp = client.options(path, headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    return resp.headers.get("Access-Control-Allow-Origin")


def check_scenario(label: str, app, expect: dict[str, bool]) -> None:
    """Assert each origin in `expect` is allowed (True) or denied (False) on
    every route; reports offending routes rather than one line per route."""
    client = app.test_client()
    all_routes = routes(app)
    for origin, should_allow in expect.items():
        wrong = [
            f"{m} {p}" for m, p in all_routes
            if (allowed_origin(client, m, p, origin) == origin) != should_allow
        ]
        verb = "allowed" if should_allow else "denied"
        check(f"{label}: {origin} {verb} on all {len(all_routes)} routes", not wrong)
        for r in wrong[:10]:
            print(f"        {r}")
        if len(wrong) > 10:
            print(f"        ... and {len(wrong) - 10} more")


def main() -> int:
    print("standalone, default allowlist")
    check_scenario("standalone default", build_app("standalone", ""),
                   {DEV_ORIGIN: True, CUSTOM_ORIGIN: False})

    print("standalone, PRIVATESCRIBE_CORS_ORIGINS override")
    check_scenario("standalone override", build_app("standalone", CUSTOM_ORIGIN),
                   {CUSTOM_ORIGIN: True, DEV_ORIGIN: False})

    print("server, nothing configured")
    check_scenario("server default", build_app("server", ""),
                   {DEV_ORIGIN: False, CUSTOM_ORIGIN: False})

    failed = [label for label, ok in _results if not ok]
    print(f"\n{len(_results) - len(failed)}/{len(_results)} checks passed.")
    if failed:
        print("FAILED:")
        for label in failed:
            print(f"  - {label}")
        return 1
    print("OK — every route honors the CORS allowlist.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        import shutil
        shutil.rmtree(_TMP, ignore_errors=True)
