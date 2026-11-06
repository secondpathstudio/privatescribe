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
    python scripts/e2e_smoke_test.py --long-minutes 80          # longer fixture
    python scripts/e2e_smoke_test.py --long-audio ~/visit.m4a   # + real engine run

Exits non-zero if any check fails, so it can gate a release build. The LLM
formatting pass (Ollama) is intentionally out of scope here — it needs a live
model; the verbatim getMarkdown path exercises the same streaming pipeline
without that dependency. Point a separate HTTP check at a running instance to
cover the full Ollama round-trip.
"""
import argparse
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
_parser = argparse.ArgumentParser(description="PrivateScribe end-to-end smoke test")
_parser.add_argument("--long-minutes", type=int, default=66,
                     help="length of the synthetic long-upload fixture (default 66)")
_parser.add_argument("--long-audio", metavar="PATH",
                     help="also run this real recording through the real STT engine (slow)")
_parser.add_argument("--diarize", action="store_true",
                     help="with --long-audio, also run speaker diarization")
_ARGS = _parser.parse_args()

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

    print("\n[6] Model-selection override + raw-save safety net")
    _model_selection_and_raw_save(app, client, auth, uid, tmpl_id)

    print("\n[7] Recording-chunk key (encrypted client-side crash buffer)")
    _recording_chunk_key(client, auth)

    print(f"\n[8] Long-duration upload ({_ARGS.long_minutes} min) — direct + queued")
    _long_duration_upload(app, client, auth)

    print("\n[9] Interrupted-job recovery (backend restart mid-transcription)")
    _interrupted_job_recovery(app, uid)

    if _ARGS.long_audio:
        print(f"\n[9b] Real-engine long recording: {_ARGS.long_audio}")
        _real_long_audio(client, auth, _ARGS.long_audio)

    # Last: it drops + recreates the template table under the app's feet.
    print("\n[10] Regression guard — schema-drift self-heal (the v1.0→v2.0 bug)")
    _schema_drift_regression(app, client, auth, uid)

    return _summary_exit()


# ---------------------------------------------------------------------------
# Long-duration uploads
# ---------------------------------------------------------------------------

def _make_long_audio(minutes: int) -> str:
    """Synthesize an N-minute mono AAC (.m4a) file with the bundled ffmpeg.

    A recorder-style compressed file keeps the fixture small (~15 MB for an
    hour) while still forcing the real decode path to expand it into a
    full-length 16 kHz WAV (~120 MB for an hour) — which is where duration
    limits, transcode timeouts and truncation would show up.
    """
    import subprocess
    from app.services import ffmpeg as ffmpeg_service

    exe = ffmpeg_service.get_ffmpeg() or ffmpeg_service.configure()
    out = os.path.join(_TMP, f"long-{minutes}min.m4a")
    subprocess.run(
        [exe, "-nostdin", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=16000:duration={minutes * 60}",
         "-ac", "1", "-c:a", "aac", "-b:a", "32k", out],
        check=True, timeout=300,
    )
    return out


class _DurationProbeEngine:
    """Stub STT engine: emits one segment per minute of the WAV it's handed.

    It reads the *decoded* WAV the route produced, so the last segment's end
    time is ground truth for "did the whole file make it through decode" —
    a truncated transcode, a silently clipped upload or a stream that dies
    partway all show up as a short timeline. No model, so a 66-minute file
    runs in seconds.
    """
    name = "e2e-duration-probe"

    def transcribe_streaming(self, wav_path, language="en", *, initial_prompt=None, batched=False):
        import wave
        with wave.open(wav_path, "rb") as w:
            duration = w.getnframes() / float(w.getframerate())
        segments, parts, t, i = [], [], 0.0, 0
        while t < duration:
            end = min(duration, t + 60.0)
            text = f"minute {i}"
            segments.append({"start": t, "end": end, "text": text})
            parts.append(text)
            yield "progress", min(1.0, end / duration)
            t, i = end, i + 1
        yield "result", (" ".join(parts), segments, [])


def _long_duration_upload(app, client, auth):
    """A long recording must make it through both upload paths end to end:
    the streaming /api/transcribe (single note) and the background job queue
    (batch upload). Guards the field report of a 66-min file stopping
    partway on Windows after an 80-min one succeeded."""
    import time
    from app.services import stt

    minutes = _ARGS.long_minutes
    expected = minutes * 60.0
    t0 = time.monotonic()
    path = _make_long_audio(minutes)
    size_mb = os.path.getsize(path) / 1e6
    check(f"synthesized {minutes}-min fixture ({size_mb:.1f} MB)", os.path.getsize(path) > 0)

    real_get_engine = stt.get_engine
    probe = _DurationProbeEngine()
    stt.get_engine = lambda name=None: probe
    try:
        # (a) Direct streaming upload — the New Note flow.
        with open(path, "rb") as f:
            r = client.post("/api/transcribe", headers=auth, data={
                "file": (f, os.path.basename(path), "audio/mp4"),
                "diarize": "false",
            }, content_type="multipart/form-data")
        events = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
        complete = next((e for e in events if e.get("stage") == "complete"), None)
        errors = [e for e in events if e.get("stage") == "error"]
        check("/api/transcribe on a long file streams a complete event (no error)",
              r.status_code == 200 and complete is not None and not errors,
              f"status={r.status_code} errors={errors} last={events[-1:] }")
        progress = [e["progress"] for e in events if "progress" in e]
        check("progress is monotonic and reaches 100%",
              bool(progress) and progress == sorted(progress) and progress[-1] >= 0.999,
              f"n={len(progress)} last={progress[-1:]}")
        check(f"decoded timeline covers the full {minutes} min (no truncation)",
              complete is not None
              and f"minute {minutes - 1}" in (complete.get("raw_note") or ""),
              f"tail={(complete or {}).get('raw_note', '')[-60:]!r}")
        check("long upload stored as an encrypted audio file",
              bool((complete or {}).get("audio_file_id")), complete and complete.get("audio_file_id"))

        # (b) Queued batch upload — the Upload Queue flow. The worker thread
        #     create_app() started picks it up; poll the job to completion.
        with open(path, "rb") as f:
            r = client.post("/api/jobs/transcribe", headers=auth, data={
                "audio": (f, os.path.basename(path), "audio/mp4"),
            }, content_type="multipart/form-data")
        job = _json(r)
        job_id = job.get("id")
        check("POST /api/jobs/transcribe (long file) → 201",
              r.status_code == 201 and bool(job_id), f"status={r.status_code} body={job}")
        deadline = time.monotonic() + 300
        seen_progress = set()
        while job_id and time.monotonic() < deadline:
            job = _json(client.get(f"/api/jobs/{job_id}", headers=auth))
            seen_progress.add(job.get("progress"))
            if job.get("status") in ("done", "failed", "canceled"):
                break
            time.sleep(0.5)
        check("queued long job finishes 'done' (not stuck running)",
              job.get("status") == "done",
              f"status={job.get('status')} stage={job.get('stage')} "
              f"progress={job.get('progress')} error={job.get('error')}")
        note_ids = job.get("noteIds") or []
        raw = ""
        if note_ids:
            raw = _json(client.get(f"/api/notes/{note_ids[0]}", headers=auth)).get("noteContentRaw") or ""
        check(f"queued draft note covers the full {minutes} min",
              f"minute {minutes - 1}" in raw, f"note_ids={note_ids} tail={raw[-60:]!r}")
    finally:
        stt.get_engine = real_get_engine
    print(f"          ({time.monotonic() - t0:.1f}s for fixture + both paths)")


def _interrupted_job_recovery(app, uid):
    """A job left `running` by a dead process (app quit / crash / update
    restart mid-transcription) must not sit at its last progress forever:
    boot requeues it, and fails it once it has been interrupted too often."""
    from app.models import Job
    from app.services import job_queue

    with app.app_context():
        # No AudioFile needed: the worker only claims type="transcription", so
        # these probe rows are never actually picked up once requeued.
        fresh = Job(author_id=uid, type="e2e-recovery", status=Job.STATUS_RUNNING,
                    attempts=1, progress=30, stage="transcribing")
        spent = Job(author_id=uid, type="e2e-recovery", status=Job.STATUS_RUNNING,
                    attempts=job_queue.MAX_ATTEMPTS, progress=30, stage="transcribing")
        db.session.add_all([fresh, spent])
        db.session.commit()
        fresh_id, spent_id = fresh.id, spent.id

    requeued, failed = job_queue.recover_interrupted_jobs(app)
    with app.app_context():
        fresh = db.session.get(Job, fresh_id)
        spent = db.session.get(Job, spent_id)
        check("interrupted job (attempt 1) is requeued with progress reset",
              fresh.status == Job.STATUS_QUEUED and fresh.progress == 0,
              f"status={fresh.status} progress={fresh.progress}")
        check(f"job interrupted {job_queue.MAX_ATTEMPTS}x is failed with a reason (no crash loop)",
              spent.status == Job.STATUS_FAILED and bool(spent.error_text),
              f"status={spent.status} error={spent.error_text!r}")
        check("recovery reports its counts", requeued >= 1 and failed >= 1,
              f"requeued={requeued} failed={failed}")
        # Tidy up so later sections see a clean queue.
        db.session.delete(fresh)
        db.session.delete(spent)
        db.session.commit()


def _real_long_audio(client, auth, path):
    """Opt-in (--long-audio PATH): push a real recording through the real STT
    engine and check the transcript reaches the end of the file. Slow — run it
    on the target machine (e.g. a Windows box) with a real 60+ min recording."""
    import time
    import wave
    from app.services import whisper

    wav = os.path.join(_TMP, "real-long.wav")
    whisper._transcode_to_wav(path, wav)
    with wave.open(wav, "rb") as w:
        duration = w.getnframes() / float(w.getframerate())
    os.unlink(wav)

    t0 = time.monotonic()
    with open(path, "rb") as f:
        r = client.post("/api/transcribe", headers=auth, data={
            "file": (f, os.path.basename(path)),
            "diarize": "true" if _ARGS.diarize else "false",
        }, content_type="multipart/form-data")
    events = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
    elapsed = time.monotonic() - t0
    final = events[-1] if events else {}
    check("real long recording streams a complete event",
          final.get("stage") == "complete", f"final={ {k: final.get(k) for k in ('stage', 'error', 'message')} }")
    segs = final.get("segments") or []
    # Non-diarized responses don't return segments; fall back to the progress stream.
    progress = [e["progress"] for e in events if "progress" in e]
    last_end = max((s.get("end") or 0) for s in segs) if segs else (progress[-1] * duration if progress else 0)
    coverage = last_end / duration if duration else 0
    check(f"transcript reaches the end of the recording (≥90% of {duration / 60:.1f} min)",
          coverage >= 0.90, f"last speech at {last_end / 60:.1f} min = {coverage:.0%}")
    print(f"          ({elapsed / 60:.1f} min wall for {duration / 60:.1f} min audio, "
          f"{len((final.get('raw_note') or '').split())} words)")


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


def _model_selection_and_raw_save(app, client, auth, uid, simple_tmpl_id):
    """Guard the create-note model picker's backend contract + the 'never lose a
    recording' safety net — both Ollama-free.

    The picker sends a per-note `model` that must win over the template's saved
    model, which in turn falls back to the app-wide default. We monkeypatch
    is_model_installed to (a) capture whichever model the route resolved and
    (b) simulate Ollama-unreachable, which lets us assert the override > template
    > default priority AND the 503 raw-note echo the frontend fallback relies on,
    with no live daemon. Finally we prove a note with empty markdown (formatting
    failed / no model) still persists, so a captured transcript is never stranded.
    """
    from app.services import settings as settings_service
    import app.services.ollama_client as oc

    raw = "Patient reports a persistent cough."
    details = {"note_date": datetime.utcnow().isoformat(), "participants": []}

    # A template with a distinctive saved model, so "template model" is
    # distinguishable from "app default" below.
    tmpl_model = "phi3:mini"
    probe_id = _json(client.post("/api/templates", headers=auth, json={
        "name": "E2E Model Probe", "content": "x {{y}}",
        "llmModel": tmpl_model, "version": 1, "authorId": uid,
    })).get("id")

    # A template with NO saved model → resolution must fall to the app default.
    nomodel_id = _json(client.post("/api/templates", headers=auth, json={
        "name": "E2E No-Model", "content": "x {{y}}", "version": 1, "authorId": uid,
    })).get("id")

    # A structured template to prove the override reaches that route too.
    struct_id = _json(client.post("/api/templates", headers=auth, json={
        "name": "E2E Structured Model", "templateType": "structured",
        "llmModel": tmpl_model,
        "structured": {"strictness": 50, "sections": [{
            "id": "s1", "title": "S", "fields": [{
                "id": "f1", "type": "paragraph", "label": "HPI",
                "variableKey": "hpi", "required": False,
                "autoFill": True, "showInSummary": True,
            }]}]},
    })).get("id")

    with app.app_context():
        default_model = settings_service.get_llm_model()
    check("app default model is distinct from the probe template's model",
          default_model and default_model != tmpl_model,
          f"default={default_model} tmpl={tmpl_model}")

    captured = {}
    orig = oc.is_model_installed

    def _spy(model_name):
        captured["model"] = model_name
        raise RuntimeError("simulated Ollama unreachable")

    oc.is_model_installed = _spy
    try:
        # (a) Per-note override wins over the template's saved model, and the
        #     503 fallback echoes the raw transcript for the client to save.
        captured.clear()
        r = client.post("/api/getMarkdown", headers=auth, json={
            "raw_note": raw, "model": "llama3.2:1b",
            "note_details": {**details, "template_id": probe_id},
        })
        body = _json(r)
        check("getMarkdown: per-note model override wins over the template model",
              captured.get("model") == "llama3.2:1b", f"resolved={captured.get('model')}")
        check("getMarkdown: 503 echoes raw_note so the recording can still be saved",
              r.status_code == 503 and body.get("raw_note") == raw,
              f"status={r.status_code} body={body}")

        # (b) No override → the template's saved model.
        captured.clear()
        client.post("/api/getMarkdown", headers=auth, json={
            "raw_note": raw, "note_details": {**details, "template_id": probe_id},
        })
        check("getMarkdown: falls back to the template's saved model when no override",
              captured.get("model") == tmpl_model, f"resolved={captured.get('model')}")

        # (c) No override + template has no model → the app-wide default.
        captured.clear()
        client.post("/api/getMarkdown", headers=auth, json={
            "raw_note": raw, "note_details": {**details, "template_id": nomodel_id},
        })
        check("getMarkdown: falls back to the app default when the template has no model",
              captured.get("model") == default_model,
              f"resolved={captured.get('model')} default={default_model}")

        # (d) The override reaches the structured route too.
        captured.clear()
        r = client.post("/api/notes/run-structured", headers=auth, json={
            "raw_note": raw, "template_id": struct_id, "model": "llama3.2:1b",
            "note_details": {**details, "template_id": struct_id},
        })
        check("run-structured: per-note model override wins over the template model",
              captured.get("model") == "llama3.2:1b" and r.status_code == 503,
              f"resolved={captured.get('model')} status={r.status_code}")
    finally:
        oc.is_model_installed = orig

    # (e) Raw-save safety net: a note with empty markdown (formatting failed,
    #     no model, or Ollama down) must still persist so the recording isn't
    #     lost. This is the backend guard behind the frontend fallback.
    r = client.post("/api/notes", headers=auth, json={
        "noteContentRaw": raw,
        "noteContentMarkdown": "",
        "authorName": "E2E Admin",
        "noteDate": datetime.utcnow().isoformat(),
        "noteTemplate": simple_tmpl_id,
    })
    body = _json(r)
    rawsave_id = body.get("id")
    check("POST /api/notes: a raw-only note (empty markdown) still saves → 201",
          r.status_code == 201 and bool(rawsave_id), f"status={r.status_code} body={body}")
    g = _json(client.get(f"/api/notes/{rawsave_id}", headers=auth))
    check("raw-only note preserves the transcript body",
          g.get("noteContentRaw") == raw, f"raw={g.get('noteContentRaw')!r}")


def _recording_chunk_key(client, auth):
    """Guard the contract behind the frontend's encrypted crash-durability
    buffer: /api/user/recording-key must hand out a stable, per-user AES-256
    key (HKDF from the SQLCipher master) plus a fingerprint the client uses to
    detect master-key rotation. Stability matters — recovery after a crash
    re-fetches the key and must get the same bytes back."""
    import base64

    r = client.get("/api/user/recording-key", headers=auth)
    body = _json(r)
    check("GET /api/user/recording-key returns 200",
          r.status_code == 200, f"status={r.status_code} body={body}")

    key_b64 = body.get("key") or ""
    fp = body.get("fingerprint") or ""
    try:
        raw = base64.b64decode(key_b64, validate=True)
    except Exception:
        raw = b""
    check("key decodes to 32 bytes (AES-256)", len(raw) == 32, f"len={len(raw)}")
    check("fingerprint is 16 lowercase hex chars",
          len(fp) == 16 and all(c in "0123456789abcdef" for c in fp), f"fp={fp!r}")

    r2 = client.get("/api/user/recording-key", headers=auth)
    b2 = _json(r2)
    check("key + fingerprint are stable across calls",
          b2.get("key") == key_b64 and b2.get("fingerprint") == fp,
          "key material changed between two calls for the same user")

    r3 = client.get("/api/user/recording-key")
    check("unauthenticated request is rejected",
          r3.status_code in (401, 422), f"status={r3.status_code}")


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
