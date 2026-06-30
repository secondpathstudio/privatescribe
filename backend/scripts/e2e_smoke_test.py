"""End-to-end smoke test for PrivateScribe's core API.

Self-contained: spins up its own encrypted temp DB and drives the *real* routes
through Flask's in-process test client — no running server, no Ollama, and no
network. It walks the major end-user flow:

    first-run setup → login → template CRUD (simple + structured) →
    streaming format (verbatim) → note create + read

and finishes with a regression guard for the v1.0→v2.0 schema-drift bug that
500'd template creation on an in-place upgrade (the missing `organization_id`
column — see app/schema_reconcile.py): it recreates the legacy table, proves
the create fails exactly as reported, then proves reconcile_schema() heals it.

    cd backend && source venv/bin/activate
    python scripts/e2e_smoke_test.py

Exits non-zero if any check fails, so it can gate a release build. The LLM
formatting pass (Ollama) is intentionally out of scope here — it needs a live
model; the verbatim getMarkdown path exercises the same streaming pipeline
without that dependency. Point a separate HTTP check at a running instance to
cover the full Ollama round-trip.
"""
import json
import os
import secrets
import sys
import tempfile
import uuid
import warnings
from datetime import datetime

warnings.filterwarnings("ignore")

# Self-contained env: isolated data dir + key, no diarization prewarm. Must be
# set before `app` is imported so create_app() picks them up.
_TMP = tempfile.mkdtemp(prefix="ps-e2e-")
os.environ["PRIVATESCRIBE_DATA_DIR"] = _TMP
os.environ.setdefault("SQLCIPHER_KEY", secrets.token_hex(32))
os.environ["HF_TOKEN"] = ""

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import AudioFile  # noqa: E402
from app.schema_reconcile import reconcile_schema  # noqa: E402

PW = "Str0ng-Passw0rd!"
ADMIN_EMAIL = "e2e-admin@example.com"

_results: list[tuple[str, bool]] = []


def check(label: str, passed: bool, detail: str = "") -> bool:
    _results.append((label, bool(passed)))
    line = f"  {'PASS' if passed else 'FAIL'}  {label}"
    if detail and not passed:
        line += f"\n          {detail}"
    print(line)
    return bool(passed)


def _json(resp):
    try:
        return resp.get_json() or {}
    except Exception:
        return {}


def main():
    app = create_app()
    client = app.test_client()

    print("\n[1] First-run setup + auth")
    r = client.get("/api/setup/status")
    body = _json(r)
    check("GET /api/setup/status → 200, needs_setup",
          r.status_code == 200 and body.get("needs_setup") is True,
          f"status={r.status_code} body={body}")

    r = client.post("/api/setup/create-admin", json={
        "email": ADMIN_EMAIL, "password": PW,
        "firstName": "E2E", "lastName": "Admin", "organization": "Test Clinic",
    })
    body = _json(r)
    admin_id = body.get("id")
    check("POST /api/setup/create-admin → 201",
          r.status_code == 201 and bool(admin_id),
          f"status={r.status_code} body={body}")

    r = client.post("/api/login", json={"email": ADMIN_EMAIL, "password": PW})
    body = _json(r)
    token = body.get("access_token")
    uid = (body.get("user") or {}).get("id") or admin_id
    check("POST /api/login → 200, access_token",
          r.status_code == 200 and bool(token),
          f"status={r.status_code} body={body}")
    if not token:
        print("\nFATAL: no access token — cannot continue.")
        return _summary_exit()
    auth = {"Authorization": f"Bearer {token}"}

    r = client.get("/api/validateToken", headers=auth)
    check("GET /api/validateToken → 200", r.status_code == 200, f"status={r.status_code}")

    print("\n[2] Template CRUD")
    r = client.post("/api/templates", headers=auth, json={
        "name": "E2E Visit Note",
        "content": "# Visit\n\n{{Summarize the visit in 2-3 sentences}}",
        "llmModel": "gemma3:4b",
        "version": 1,
        "authorId": uid,
    })
    body = _json(r)
    tmpl_id = body.get("id")
    check("POST /api/templates (simple) → 201",
          r.status_code == 201 and bool(tmpl_id),
          f"status={r.status_code} body={body}")

    r = client.post("/api/templates", headers=auth, json={
        "name": "E2E Structured",
        "templateType": "structured",
        "structured": {
            "strictness": 50,
            "sections": [{
                "id": "s1", "title": "Subjective",
                "fields": [{
                    "id": "f1", "type": "paragraph", "label": "HPI",
                    "variableKey": "hpi", "required": False,
                    "autoFill": True, "showInSummary": True,
                }],
            }],
        },
    })
    check("POST /api/templates (structured) → 201",
          r.status_code == 201, f"status={r.status_code} body={_json(r)}")

    r = client.get(f"/api/templates/user/{uid}", headers=auth)
    body = _json(r)
    ids = [t.get("id") for t in body] if isinstance(body, list) else []
    check("GET /api/templates/user/<id> lists the created template",
          tmpl_id in ids, f"status={r.status_code} ids={ids}")

    r = client.get(f"/api/templates/{tmpl_id}", headers=auth)
    check("GET /api/templates/<id> → 200", r.status_code == 200, f"status={r.status_code}")

    r = client.put(f"/api/templates/{tmpl_id}", headers=auth,
                   json={"name": "E2E Visit Note (renamed)"})
    body = _json(r)
    check("PUT /api/templates/<id> renames + bumps version",
          r.status_code == 200 and body.get("name") == "E2E Visit Note (renamed)"
          and body.get("version") == 2,
          f"status={r.status_code} body={body}")

    print("\n[3] Streaming format — verbatim path (no Ollama needed)")
    raw = "Patient reports mild headache for two days."
    r = client.post("/api/getMarkdown", headers=auth, json={
        "raw_note": raw,
        "note_details": {"note_date": datetime.utcnow().isoformat(), "participants": []},
    })
    events = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
    complete = next((e for e in events if e.get("stage") == "complete"), {})
    check("POST /api/getMarkdown (verbatim) streams a complete event with the raw text",
          r.status_code == 200 and complete.get("markdown") == raw,
          f"status={r.status_code} events={events}")

    print("\n[4] Note create + read")
    r = client.post("/api/notes", headers=auth, json={
        "noteContentRaw": raw,
        "noteContentMarkdown": "# Visit\n\nPatient reports mild headache.",
        "authorName": "E2E Admin",
        "noteDate": datetime.utcnow().isoformat(),
        "noteTemplate": tmpl_id,
    })
    body = _json(r)
    note_id = body.get("id")
    check("POST /api/notes → 201",
          r.status_code == 201 and bool(note_id), f"status={r.status_code} body={body}")

    r = client.get(f"/api/notes/{note_id}", headers=auth)
    check("GET /api/notes/<id> → 200", r.status_code == 200, f"status={r.status_code}")

    r = client.get(f"/api/notes/user/{uid}", headers=auth)
    body = _json(r)
    note_ids = [n.get("id") for n in body] if isinstance(body, list) else []
    check("GET /api/notes/user/<id> lists the created note",
          note_id in note_ids, f"status={r.status_code} ids={note_ids}")

    print("\n[5] Append recording to a draft note")
    _append_recording_flow(app, client, auth, uid)

    print("\n[6] Regression guard — schema-drift self-heal (the v1.0→v2.0 bug)")
    _schema_drift_regression(app, client, auth, uid)

    return _summary_exit()


def _append_recording_flow(app, client, auth, uid):
    """Exercise append-recording end to end: the admin toggle + its surfacing on
    the user payload, the diarized merge (speaker renumber + timeline offset +
    per-clip audioFileId tagging), the audio-source history, edit-preservation
    of the tags, and the draft-only + admin gates. Ollama-free — the endpoint
    only merges the transcript; the frontend re-format is a separate step."""
    # Enable the feature, and confirm it reaches the cached user payload.
    r = client.put("/api/admin/settings/append-recording-enabled", headers=auth,
                   json={"value": True})
    check("PUT append-recording-enabled → true",
          r.status_code == 200 and _json(r).get("append_recording_enabled") is True,
          f"status={r.status_code} body={_json(r)}")
    r = client.get("/api/validateToken", headers=auth)
    check("validateToken exposes appendRecordingEnabled=true",
          (_json(r).get("user") or {}).get("appendRecordingEnabled") is True, _json(r))

    # Seed two orphan AudioFile rows, as /api/transcribe would before linking
    # (the byte payload is out of scope; we only need the rows to link to).
    def _seed_audio(name):
        with app.app_context():
            row = AudioFile(author_id=uid, original_filename=name,
                            stored_filename=str(uuid.uuid4()),
                            mime_type="audio/webm", size_bytes=1000)
            db.session.add(row)
            db.session.commit()
            return row.id

    a1, a2 = _seed_audio("original.webm"), _seed_audio("appended.webm")

    # Create a diarized draft linked to the original clip.
    base_segs = [
        {"speaker": "Speaker 1", "start": 0.0, "end": 2.0, "text": "Opening line."},
        {"speaker": "Speaker 2", "start": 2.0, "end": 4.0, "text": "A reply."},
    ]
    r = client.post("/api/notes", headers=auth, json={
        "noteContentRaw": "Speaker 1: Opening line.\nSpeaker 2: A reply.",
        "noteContentMarkdown": "# Visit\n\nOpening line. A reply.",
        "noteContentSegments": base_segs,
        "authorName": "E2E Admin",
        "noteDate": datetime.utcnow().isoformat(),
        "audioFileId": a1,
    })
    note = _json(r)
    nid = note.get("id")
    check("POST /api/notes (diarized draft + audio) → 201",
          r.status_code == 201 and bool(nid), f"status={r.status_code} body={note}")

    g0 = _json(client.get(f"/api/notes/{nid}", headers=auth))
    check("created turns tagged with the original clip id",
          [s.get("audioFileId") for s in (g0.get("noteContentSegments") or [])] == [a1, a1],
          [s.get("audioFileId") for s in (g0.get("noteContentSegments") or [])])

    # Append a second diarized recording linked to the second clip.
    add_segs = [
        {"speaker": "Speaker 1", "start": 0.0, "end": 1.5, "text": "Follow-up."},
        {"speaker": "Speaker 2", "start": 1.5, "end": 3.0, "text": "Understood."},
    ]
    r = client.post(f"/api/notes/{nid}/append-recording", headers=auth, json={
        "rawNote": "Speaker 1: Follow-up.\nSpeaker 2: Understood.",
        "noteContentSegments": add_segs,
        "audioFileId": a2,
    })
    ap = _json(r)
    check("append-recording → 200", r.status_code == 200, f"status={r.status_code} body={ap}")
    segs = ap.get("noteContentSegments") or []
    check("appended speakers renumbered to (1,2,3,4)",
          [s.get("speaker") for s in segs] == ["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4"],
          [s.get("speaker") for s in segs])
    check("appended turns offset past the base timeline (4.0)",
          [s.get("start") for s in segs] == [0.0, 2.0, 4.0, 5.5],
          [s.get("start") for s in segs])
    check("turns carry source ordinals [0,0,1,1]",
          [s.get("source") for s in segs] == [0, 0, 1, 1],
          [s.get("source") for s in segs])
    check("turns linked to clips by id [a1,a1,a2,a2]",
          [s.get("audioFileId") for s in segs] == [a1, a1, a2, a2],
          [s.get("audioFileId") for s in segs])
    check("raw transcript rebuilt from the merged segments",
          (ap.get("noteContentRaw") or "").endswith("Speaker 4: Understood."),
          repr(ap.get("noteContentRaw")))
    check("note version bumped to 2", ap.get("version") == 2, ap.get("version"))

    # The audio-source history is exposed in recording order.
    g = _json(client.get(f"/api/notes/{nid}", headers=auth))
    check("note exposes audioFiles history ordered [a1,a2]",
          [af.get("id") for af in (g.get("audioFiles") or [])] == [a1, a2],
          [af.get("id") for af in (g.get("audioFiles") or [])])

    # Editing the transcript preserves the source + clip tags.
    ed = _json(client.put(f"/api/notes/{nid}/segments", headers=auth,
                          json={"segments": g.get("noteContentSegments")}))
    edited = ed.get("noteContentSegments") or []
    check("segment edit preserves source ordinals",
          [s.get("source") for s in edited] == [0, 0, 1, 1],
          [s.get("source") for s in edited])
    check("segment edit preserves clip links",
          [s.get("audioFileId") for s in edited] == [a1, a1, a2, a2],
          [s.get("audioFileId") for s in edited])

    # Draft-only gate: approving locks the transcript, so append now 409s.
    r = client.put(f"/api/notes/{nid}/approve", headers=auth)
    check("approve note → 200", r.status_code == 200, f"status={r.status_code}")
    r = client.post(f"/api/notes/{nid}/append-recording", headers=auth,
                    json={"rawNote": "should be blocked"})
    check("append after approve → 409 (locked)",
          r.status_code == 409, f"status={r.status_code} body={_json(r)}")

    # Admin gate (defense in depth): disabling the feature → append 403s.
    client.put("/api/admin/settings/append-recording-enabled", headers=auth,
               json={"value": False})
    r = client.post(f"/api/notes/{nid}/append-recording", headers=auth,
                    json={"rawNote": "should be blocked"})
    check("append while feature disabled → 403",
          r.status_code == 403, f"status={r.status_code} body={_json(r)}")


def _schema_drift_regression(app, client, auth, uid):
    """Recreate `template` with the legacy 1.0 column set (no organization_id),
    prove a create now fails exactly as the field bug did, then prove
    reconcile_schema() heals it so the same create returns 201."""
    payload = {
        "name": "Drift Probe",
        "content": "x {{y}}",
        "llmModel": "gemma3:4b",
        "version": 1,
        "authorId": uid,
    }

    with app.app_context():
        conn = db.engine.raw_connection()
        try:
            cur = conn.cursor()
            cur.execute("PRAGMA foreign_keys=OFF")
            cur.execute("DROP TABLE template")
            cur.execute(
                "CREATE TABLE template ("
                "id VARCHAR(36) NOT NULL PRIMARY KEY, "
                "name VARCHAR(50) NOT NULL, "
                "template_type VARCHAR(16) NOT NULL, "
                "content TEXT, structured JSON, llm_model VARCHAR(100), "
                "created_at DATETIME, updated_at DATETIME, "
                "version INTEGER NOT NULL, "
                "is_deleted BOOLEAN, is_deleted_timestamp DATETIME, "
                "author_id VARCHAR(36) NOT NULL)"
            )
            conn.commit()
        finally:
            conn.close()
        db.engine.dispose()  # drop pooled connections so the next request re-reads schema

    r = client.post("/api/templates", headers=auth, json=payload)
    check("legacy schema reproduces the reported failure (create → 5xx)",
          r.status_code >= 500, f"expected 5xx, got {r.status_code}")

    with app.app_context():
        applied = reconcile_schema()
        db.engine.dispose()
    check("reconcile_schema() re-adds organization_id (+ index)",
          any("organization_id" in a for a in applied), f"applied={applied}")

    r = client.post("/api/templates", headers=auth, json=payload)
    check("after reconcile, the same create → 201",
          r.status_code == 201, f"status={r.status_code} body={_json(r)}")


def _summary_exit():
    passed = sum(1 for _, ok in _results if ok)
    total = len(_results)
    print("\n" + "=" * 60)
    print(f"  {passed}/{total} checks passed")
    print("=" * 60)
    failed = [label for label, ok in _results if not ok]
    if failed:
        print("FAILED:")
        for label in failed:
            print("  -", label)
    sys.stdout.flush()
    # Hard-exit so the background job worker thread can't keep the process alive.
    os._exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
