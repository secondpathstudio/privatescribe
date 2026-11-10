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

    print("\n[6b] LLM context window — explicit num_ctx, overflow falls back to raw")
    _llm_context_window(app, client, auth, uid, tmpl_id)

    print("\n[6c] Long transcripts read in parts (map-reduce batching)")
    _llm_batching(app, client, auth, tmpl_id)

    print("\n[6d] Reading in parts — structured templates and queued uploads")
    _llm_batching_structured_and_jobs(app, client, auth, tmpl_id)

    print("\n[7] Recording-chunk key (encrypted client-side crash buffer)")
    _recording_chunk_key(client, auth)

    print(f"\n[8] Long-duration upload ({_ARGS.long_minutes} min) — direct + queued")
    _long_duration_upload(app, client, auth)

    print("\n[9] Interrupted-job recovery (backend restart mid-transcription)")
    _interrupted_job_recovery(app, uid)

    print("\n[10] Job liveness — heartbeat, stall flag, diarization progress")
    _job_liveness(app, client, auth, uid)

    print("\n[11] Cancel + retry (incl. canceling a running job)")
    _cancel_and_retry(app, client, auth, uid)

    print("\n[11a] Direct upload streams diarization progress (+ stops on disconnect)")
    _stream_diarization_progress(client, auth)

    if _ARGS.long_audio:
        print(f"\n[11b] Real-engine long recording: {_ARGS.long_audio}")
        _real_long_audio(client, auth, _ARGS.long_audio)

    # Last: it drops + recreates the template table under the app's feet.
    print("\n[12] Regression guard — schema-drift self-heal (the v1.0→v2.0 bug)")
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


def _job_liveness(app, client, auth, uid):
    """The queue UI must be able to tell slow-but-working from hung: the job
    API reports a server-computed stall verdict off a heartbeat that only
    real work advances, and diarization (previously a silent 62%) now
    reports progress through pyannote's hook."""
    import time
    from datetime import timedelta
    from app.models import Job
    from app.services import diarization, job_queue, stt

    # (a) Stall verdict, via the API, for backdated heartbeats. Probe rows use a
    #     non-transcription type so the worker never claims them.
    now = datetime.utcnow()
    cases = [
        ("fresh heartbeat → not stalled", "transcribing", timedelta(seconds=10), False),
        ("no progress past STALL_AFTER_SEC → stalled", "transcribing",
         timedelta(seconds=job_queue.STALL_AFTER_SEC + 60), True),
        ("formatting gets the longer LLM threshold → not stalled", "formatting (1/1)",
         timedelta(seconds=job_queue.STALL_AFTER_SEC + 60), False),
        ("formatting past FORMAT_STALL_AFTER_SEC → stalled", "formatting (1/1)",
         timedelta(seconds=job_queue.FORMAT_STALL_AFTER_SEC + 60), True),
    ]
    probe_ids = []
    with app.app_context():
        for _label, stage, ago, _want in cases:
            j = Job(author_id=uid, type="e2e-liveness", status=Job.STATUS_RUNNING,
                    stage=stage, progress=30, started_at=now - ago, heartbeat_at=now - ago)
            db.session.add(j)
            db.session.flush()
            probe_ids.append(j.id)
        db.session.commit()
    for (label, _stage, ago, want), jid in zip(cases, probe_ids):
        body = _json(client.get(f"/api/jobs/{jid}", headers=auth))
        age = body.get("secondsSinceHeartbeat")
        check(f"stall flag: {label}",
              body.get("stalled") is want and isinstance(age, int)
              and abs(age - ago.total_seconds()) < 30,
              f"stalled={body.get('stalled')} age={age} body_keys={sorted(body)[:6]}")
    with app.app_context():
        for jid in probe_ids:
            db.session.delete(db.session.get(Job, jid))
        db.session.commit()

    # (b) Throttled writer: the first update saves, later ones inside the
    #     interval don't, force=True always does.
    with app.app_context():
        j = Job(author_id=uid, type="e2e-liveness", status=Job.STATUS_RUNNING, progress=0)
        db.session.add(j)
        db.session.commit()
        w = job_queue._ProgressWriter(j, interval=3600)
        w.update(5, "transcribing")
        first = j.heartbeat_at
        time.sleep(0.01)
        w.update(10)
        unthrottled = j.heartbeat_at
        time.sleep(0.01)
        w.update(20, "labeling speakers", force=True)
        forced = j.heartbeat_at
        check("progress writer: first update saves a heartbeat", first is not None)
        check("progress writer: updates inside the interval don't commit",
              unthrottled == first, f"{first} vs {unthrottled}")
        check("progress writer: force=True commits (stage transition)",
              forced is not None and forced > first, f"{first} vs {forced}")
        db.session.delete(j)
        db.session.commit()

    # (c) pyannote hook adapter: realistic call sequence → monotonic 0..1.
    seen = []
    hook = diarization._progress_hook(lambda f, label: seen.append((f, label)))
    hook("segmentation", None, file={}, total=4, completed=0)
    hook("segmentation", None, file={}, total=4, completed=4)
    hook("segmentation", object(), file={})
    hook("speaker_counting", object(), file={})
    for i in range(0, 11):
        hook("embeddings", None, file={}, total=10, completed=i)
    hook("embeddings", object(), file={})
    hook("discrete_diarization", object(), file={})
    hook("unknown_future_step", object(), file={})  # ignored, not an error
    fracs = [f for f, _ in seen]
    check("diarization hook: fractions are monotonic and end at 1.0",
          fracs == sorted(fracs) and fracs[-1] == 1.0 and fracs[0] == 0.0, fracs)
    check("diarization hook: batched steps carry counts in the label",
          any(label == "embeddings 5/10" for _, label in seen), [l for _, l in seen])
    boom = diarization._progress_hook(lambda f, label: 1 / 0)
    try:
        boom("embeddings", None, file={}, total=2, completed=1)
        swallowed = True
    except Exception:
        swallowed = False
    check("diarization hook: a failing progress callback can't abort diarization", swallowed)

    # (d) End to end through the worker: a diarized queued job reports
    #     progress from inside diarization, inside its 55-70 band.
    updates = []
    real_update = job_queue._ProgressWriter.update

    def spy_update(self, progress=None, stage=None, *, force=False):
        updates.append((self.job.progress if progress is None else int(progress),
                        stage or self.job.stage))
        return real_update(self, progress, stage, force=force)

    def fake_diarize(path, num_speakers=None, max_speakers=None, progress=None):
        hook = diarization._progress_hook(progress) if progress else None
        if hook:
            hook("segmentation", object(), file={})
            for i in range(0, 5):
                hook("embeddings", None, file={}, total=4, completed=i)
            hook("discrete_diarization", object(), file={})
        return [{"start": 0.0, "end": 60.0, "speaker": "SPEAKER_00"},
                {"start": 60.0, "end": 120.0, "speaker": "SPEAKER_01"}]

    real = (stt.get_engine, diarization.is_available, diarization.diarize_path)
    probe = _DurationProbeEngine()
    stt.get_engine = lambda name=None: probe
    diarization.is_available = lambda: True
    diarization.diarize_path = fake_diarize
    job_queue._ProgressWriter.update = spy_update
    try:
        path = _make_long_audio(2)
        with open(path, "rb") as f:
            r = client.post("/api/jobs/transcribe", headers=auth, data={
                "audio": (f, "two-speakers.m4a", "audio/mp4"), "diarize": "true",
            }, content_type="multipart/form-data")
        job_id = _json(r).get("id")
        deadline = time.monotonic() + 120
        job = {}
        while job_id and time.monotonic() < deadline:
            job = _json(client.get(f"/api/jobs/{job_id}", headers=auth))
            if job.get("status") in ("done", "failed", "canceled"):
                break
            time.sleep(0.3)
    finally:
        stt.get_engine, diarization.is_available, diarization.diarize_path = real
        job_queue._ProgressWriter.update = real_update
    check("diarized queued job finishes done", job.get("status") == "done",
          f"status={job.get('status')} error={job.get('error')}")
    check("finished job reports no stall + no heartbeat age",
          job.get("stalled") is False and job.get("secondsSinceHeartbeat") is None,
          f"stalled={job.get('stalled')} age={job.get('secondsSinceHeartbeat')}")
    diar = [(p, st) for p, st in updates if (st or "").startswith("labeling speakers")]
    check("worker reports progress from inside diarization",
          len(diar) >= 5 and any("embeddings" in st for _, st in diar),
          [st for _, st in diar])
    check("diarization progress stays in its 55-70 band",
          bool(diar) and all(job_queue.PROGRESS_TRANSCRIBE_END <= p <= job_queue.PROGRESS_DIARIZE_END
                             for p, _ in diar), [p for p, _ in diar])
    check("overall progress never goes backwards",
          [p for p, _ in updates] == sorted(p for p, _ in updates), [p for p, _ in updates])
    note_ids = job.get("noteIds") or []
    segs = (_json(client.get(f"/api/notes/{note_ids[0]}", headers=auth)).get("noteContentSegments")
            if note_ids else None) or []
    check("diarized draft note carries speaker-labeled segments",
          len({s.get("speaker") for s in segs}) == 2, [s.get("speaker") for s in segs])


class _GatedEngine(_DurationProbeEngine):
    """Probe engine that parks mid-transcription until released, so a test can
    act on a job while the worker thread is genuinely inside it."""
    name = "e2e-gated"

    def __init__(self):
        import threading
        self.entered = threading.Event()
        self.release = threading.Event()

    def transcribe_streaming(self, wav_path, language="en", *, initial_prompt=None, batched=False):
        first = True
        for kind, payload in super().transcribe_streaming(wav_path, language):
            yield kind, payload
            if first:
                first = False
                self.entered.set()
                self.release.wait(60)


def _cancel_and_retry(app, client, auth, uid):
    """Cancel must work on a *running* job (cooperatively, at the worker's
    next checkpoint), never be overwritten by the worker finishing, and leave
    no partial drafts; retry re-queues a failed/canceled job from its stored
    recording, but refuses while the worker still holds it."""
    import time
    from app.models import AudioFile, Job, Note
    from app.services import diarization, job_queue, stt

    def wait_for(pred, timeout=60):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            v = pred()
            if v:
                return v
            time.sleep(0.2)
        return None

    gated = _GatedEngine()
    real_engine, real_interval = stt.get_engine, job_queue.HEARTBEAT_SAVE_SEC
    stt.get_engine = lambda name=None: gated
    job_queue.HEARTBEAT_SAVE_SEC = 0  # every progress event is a checkpoint
    try:
        path = _make_long_audio(3)
        with open(path, "rb") as f:
            r = client.post("/api/jobs/transcribe", headers=auth, data={
                "audio": (f, "cancel-me.m4a", "audio/mp4"),
            }, content_type="multipart/form-data")
        jid = _json(r).get("id")
        check("gated job is running with the worker inside it",
              gated.entered.wait(60) and _json(client.get(f"/api/jobs/{jid}", headers=auth)).get("status") == "running")

        r = client.post(f"/api/jobs/{jid}/cancel", headers=auth)
        body = _json(r)
        check("cancel a RUNNING job → 200, canceled immediately",
              r.status_code == 200 and body.get("status") == "canceled", f"status={r.status_code} body={body}")
        check("while the thread is still inside it, workerHeld=true",
              body.get("workerHeld") is True, body.get("workerHeld"))
        r = client.post(f"/api/jobs/{jid}/retry", headers=auth)
        check("retry while the worker still holds the job → 409 (no double-processing)",
              r.status_code == 409, f"status={r.status_code} body={_json(r)}")

        gated.release.set()  # let the thread run to its next checkpoint
        released = wait_for(lambda: not _json(client.get(f"/api/jobs/{jid}", headers=auth)).get("workerHeld"))
        job = _json(client.get(f"/api/jobs/{jid}", headers=auth))
        check("worker stops at its next checkpoint and lets go", bool(released), job)
        check("the cancel sticks — worker didn't overwrite it with done/failed",
              job.get("status") == "canceled" and not job.get("error"),
              f"status={job.get('status')} error={job.get('error')}")
        with app.app_context():
            audio = db.session.get(AudioFile, job.get("audioFileId"))
            check("canceled job left no draft notes and no transcript group",
                  not job.get("noteIds") and audio.transcript_group_id is None,
                  f"noteIds={job.get('noteIds')} group={audio.transcript_group_id}")

        # Retry the canceled job: requeued from the stored audio, runs to done.
        r = client.post(f"/api/jobs/{jid}/retry", headers=auth)
        body = _json(r)
        check("retry a canceled job → 200, queued with progress/error reset",
              r.status_code == 200 and body.get("status") == "queued"
              and body.get("progress") == 0 and not body.get("error"),
              f"status={r.status_code} body={body}")
        job = wait_for(lambda: (lambda j: j if j.get("status") in ("done", "failed", "canceled") else None)(
            _json(client.get(f"/api/jobs/{jid}", headers=auth))))
        check("retried job completes with a draft note",
              bool(job) and job.get("status") == "done" and len(job.get("noteIds") or []) == 1, job)
    finally:
        gated.release.set()
        stt.get_engine, job_queue.HEARTBEAT_SAVE_SEC = real_engine, real_interval

    # Terminal states: done can't be canceled or retried.
    r = client.post(f"/api/jobs/{jid}/cancel", headers=auth)
    check("cancel a done job → 409", r.status_code == 409, f"status={r.status_code}")
    r = client.post(f"/api/jobs/{jid}/retry", headers=auth)
    check("retry a done job → 409", r.status_code == 409, f"status={r.status_code}")

    with app.app_context():
        # A failed job whose recording is gone can't be retried.
        orphan = Job(author_id=uid, type="e2e-cancel", status=Job.STATUS_FAILED, error_text="x")
        # Worker CAS: running -> done misses once the user canceled.
        raced = Job(author_id=uid, type="e2e-cancel", status=Job.STATUS_CANCELED)
        db.session.add_all([orphan, raced])
        db.session.commit()
        orphan_id, raced_id = orphan.id, raced.id
        won = job_queue._transition(raced_id, Job.STATUS_RUNNING, status=Job.STATUS_DONE)
        db.session.commit()
        check("worker's finish CAS misses on a canceled job",
              won is False and db.session.get(Job, raced_id).status == Job.STATUS_CANCELED)
    job_queue._mark_failed(app, raced_id, "late failure")
    with app.app_context():
        check("a late failure doesn't clobber a cancel",
              db.session.get(Job, raced_id).status == Job.STATUS_CANCELED)
    r = client.post(f"/api/jobs/{orphan_id}/retry", headers=auth)
    check("retry with no stored recording → 409 with a re-upload hint",
          r.status_code == 409 and "Upload it again" in (_json(r).get("error") or ""),
          f"status={r.status_code} body={_json(r)}")

    # Cancel raised inside a pyannote progress callback must propagate.
    hook = diarization._progress_hook(lambda f, label: (_ for _ in ()).throw(job_queue.JobCanceled("x")))
    try:
        hook("embeddings", None, file={}, total=2, completed=1)
        propagated = False
    except job_queue.JobCanceled:
        propagated = True
    check("cancel propagates out of diarization's progress hook", propagated)

    with app.app_context():
        for i in (orphan_id, raced_id):
            db.session.delete(db.session.get(Job, i))
        db.session.commit()


def _stream_diarization_progress(client, auth):
    """/api/transcribe used to go silent for all of diarization — on a long CPU
    run, indistinguishable from a hang. It now streams pyannote's progress,
    keeps the diarization_unavailable fallback, and stops diarizing when the
    client goes away."""
    import threading
    import time
    import app.routes.transcription as tr
    from app.services import diarization, stt

    path = _make_long_audio(2)
    probe = _DurationProbeEngine()
    real_engine, real_diarize = stt.get_engine, tr.diarize_path
    stt.get_engine = lambda name=None: probe

    def post():
        f = open(path, "rb")
        return client.post("/api/transcribe", headers=auth, data={
            "file": (f, "two-speakers.m4a", "audio/mp4"), "diarize": "true",
        }, content_type="multipart/form-data", buffered=False)

    try:
        # (a) Progress events, in order, then a diarized complete event.
        def fake_diarize(p, num_speakers=None, max_speakers=None, progress=None):
            hook = diarization._progress_hook(progress)
            hook("segmentation", object(), file={})
            for i in range(0, 41):
                hook("embeddings", None, file={}, total=40, completed=i)
            hook("discrete_diarization", object(), file={})
            return [{"start": 0.0, "end": 60.0, "speaker": "SPEAKER_00"},
                    {"start": 60.0, "end": 120.0, "speaker": "SPEAKER_01"}]

        tr.diarize_path = fake_diarize
        r = post()
        events = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
        diar = [e for e in events if e.get("stage") == "diarizing" and "progress" in e]
        fr = [e["progress"] for e in diar]
        check("diarizing stage streams progress events", len(diar) >= 3, f"n={len(diar)}")
        check("diarization progress is monotonic and reaches 100%",
              fr == sorted(fr) and fr[-1] == 1.0, fr)
        check("progress events carry a step detail (e.g. 'embeddings 20/40')",
              any("embeddings" in (e.get("detail") or "") for e in diar), [e.get("detail") for e in diar])
        check("throttled — not one event per pyannote batch", len(diar) < 43, f"n={len(diar)}")
        final = events[-1] if events else {}
        check("still ends in a diarized complete event",
              final.get("stage") == "complete" and len({s.get("speaker") for s in final.get("segments") or []}) == 2,
              {k: final.get(k) for k in ("stage", "error", "message")})

        # (b) Fallback contract unchanged when diarization is unavailable.
        def unavailable(*a, **k):
            raise diarization.DiarizationUnavailable("no pipeline")
        tr.diarize_path = unavailable
        events = [json.loads(l) for l in post().get_data(as_text=True).splitlines() if l.strip()]
        final = events[-1] if events else {}
        check("diarization_unavailable still falls back with the raw transcript",
              final.get("error") == "diarization_unavailable" and "minute 1" in (final.get("raw_note") or ""),
              {k: final.get(k) for k in ("stage", "error")})

        # (c) Client disconnects mid-diarization → diarization is told to stop.
        aborted = threading.Event()

        def slow_diarize(p, num_speakers=None, max_speakers=None, progress=None):
            hook = diarization._progress_hook(progress)
            try:
                for i in range(0, 600):
                    hook("embeddings", None, file={}, total=600, completed=i)
                    time.sleep(0.02)
            except diarization.ProgressAbort:
                aborted.set()
                raise
            return []

        tr.diarize_path = slow_diarize
        r = post()
        saw_progress = False
        for chunk in r.response:
            line = chunk.decode() if isinstance(chunk, bytes) else chunk
            if '"diarizing"' in line and '"progress"' in line:
                saw_progress = True
                break
        r.close()  # what the server does when the client goes away
        check("disconnect mid-diarization stops pyannote (ProgressAbort raised)",
              saw_progress and aborted.wait(10), f"saw_progress={saw_progress} aborted={aborted.is_set()}")
    finally:
        stt.get_engine, tr.diarize_path = real_engine, real_diarize


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


def _llm_context_window(app, client, auth, uid, simple_tmpl_id):
    """Ollama's default window (~2k tokens) silently dropped most of a long
    transcript — and a long enough one left no room to reply: an empty note.
    Every formatting call must now ask for NUM_CTX, a transcript that can't
    fit must be caught before the call, and Ollama running out of room after
    the call must fall back to the raw transcript, flagged as an overflow (not
    as Ollama being down). Fake `chat`, so no live model is needed."""
    import time
    from types import SimpleNamespace
    import app.services.ollama_client as oc
    from app.services import job_queue, stt

    details = {"note_date": datetime.utcnow().isoformat(), "participants": []}
    tpl = SimpleNamespace(name="Visit", content="# Visit\n\n{{Summarize the visit}}")
    short = "Speaker 1: How are the headaches? Speaker 2: Better this week."
    hour = ("Speaker 1: So how have the headaches been since we last talked? Speaker 2: A bit "
            "better, two or three a week, mostly mornings, ibuprofen helps some. ") * 220  # ~35k chars ≈ 1h
    huge = hour * 3

    calls = []
    script = {"done_reason": "stop", "prompt_eval_count": 500, "content": "# Visit\n\nFormatted."}

    def fake_chat(**kw):
        calls.append(kw)
        if kw.get("stream"):
            def gen():
                yield {"message": {"content": script["content"]}, "done": False}
                yield {"message": {"content": ""}, "done": True,
                       "done_reason": script["done_reason"], "prompt_eval_count": script["prompt_eval_count"]}
            return gen()
        return {"message": {"content": script["content"]}, "done_reason": script["done_reason"],
                "prompt_eval_count": script["prompt_eval_count"]}

    real_chat, real_installed = oc.chat, oc.is_model_installed
    oc.chat = fake_chat
    oc.is_model_installed = lambda name: True
    try:
        # (a) Every call asks for the explicit window.
        out = oc.generate_markdown(tpl, short, details, "gemma3:4b")
        check("generate_markdown sends num_ctx=NUM_CTX (16k)",
              calls and calls[-1]["options"].get("num_ctx") == oc.NUM_CTX == 16384,
              calls[-1]["options"] if calls else None)
        check("a normal reply comes back unchanged", out == script["content"], out)

        # (b) Pre-call estimate: an hour fits, three hours is caught before any call.
        hour_msgs = oc._build_markdown_messages(tpl, hour, details)
        try:
            est = oc.ensure_fits(hour_msgs)
            fits_hour = True
        except oc.ContextOverflow:
            est, fits_hour = None, False
        check(f"an hour-long transcript fits the window (est {est} tokens)", fits_hour)
        n = len(calls)
        try:
            oc.generate_markdown(tpl, huge, details, "gemma3:4b")
            raised = False
        except oc.ContextOverflow:
            raised = True
        check("an oversized transcript raises ContextOverflow before calling Ollama",
              raised and len(calls) == n, f"raised={raised} new_calls={len(calls) - n}")

        # (c) Post-call backstop: Ollama says it ran out of room.
        for label, reason, count, want_cut in [
                ("reply ran out of room", "length", 4000, True),
                ("prompt filled the window", "stop", oc.NUM_CTX, False)]:
            script.update(done_reason=reason, prompt_eval_count=count)
            try:
                oc.generate_markdown(tpl, short, details, "gemma3:4b")
                err = None
            except oc.ContextOverflow as e:
                err = e
            check(f"post-call overflow detected + cause named ({label})",
                  err is not None and err.reply_cut is want_cut
                  and (("ran out of room" in str(err)) if want_cut else ("too long" in str(err))),
                  str(err))
        script.update(done_reason="stop", prompt_eval_count=500)

        # (d) /api/getMarkdown: overflow is a distinct error code, not an outage.
        def stream(raw):
            r = client.post("/api/getMarkdown", headers=auth, json={
                "raw_note": raw, "note_details": {**details, "template_id": simple_tmpl_id}})
            return [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]

        ev = stream(short)
        check("getMarkdown streams normally when it fits",
              ev[-1].get("stage") == "complete" and calls[-1]["options"].get("num_ctx") == oc.NUM_CTX, ev[-1:])
        # Too long even to read in parts (batching itself is covered in [6c]).
        from app.services import llm_batching
        real_rounds, llm_batching.MAX_ROUNDS = llm_batching.MAX_ROUNDS, 0
        try:
            ev = stream(huge)
        finally:
            llm_batching.MAX_ROUNDS = real_rounds
        check("getMarkdown: can't fit even in parts → error event context_overflow, no chunks",
              ev[-1].get("error") == "context_overflow" and not any(e.get("stage") == "chunk" for e in ev),
              ev)
        script.update(done_reason="length")
        ev = stream(short)
        check("getMarkdown: Ollama ran out of room mid-stream → context_overflow",
              ev[-1].get("error") == "context_overflow", ev[-1:])
        script.update(done_reason="stop")

        # (e) Structured per-field: one overflow ends the run (raw fallback),
        #     instead of every field flagged blank in turn.
        sid = _json(client.post("/api/templates", headers=auth, json={
            "name": "E2E Ctx Structured", "templateType": "structured", "llmModel": "gemma3:4b",
            "structured": {"strictness": 100, "sections": [{"id": "s1", "title": "S", "fields": [
                {"id": f"f{i}", "type": "paragraph", "label": f"F{i}", "variableKey": f"f{i}",
                 "required": False, "autoFill": True, "showInSummary": True} for i in range(3)]}]},
        })).get("id")
        real_rounds, llm_batching.MAX_ROUNDS = llm_batching.MAX_ROUNDS, 0
        try:
            r = client.post("/api/notes/run-structured", headers=auth, json={
                "raw_note": huge, "template_id": sid, "note_details": {**details, "template_id": sid}})
            ev = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
        finally:
            llm_batching.MAX_ROUNDS = real_rounds
        check("run-structured: can't fit even in parts → one context_overflow error, not per-field flags",
              ev and ev[-1].get("error") == "context_overflow"
              and sum(1 for e in ev if e.get("stage") == "field_error") == 0,
              [e.get("stage") for e in ev])

        # (f) Queued job: an overflow keeps the full transcript as the draft body.
        script.update(done_reason="length")
        probe = _DurationProbeEngine()
        real_engine = stt.get_engine
        stt.get_engine = lambda name=None: probe
        try:
            path = _make_long_audio(2)
            with open(path, "rb") as f:
                r = client.post("/api/jobs/transcribe", headers=auth, data={
                    "audio": (f, "overflow.m4a", "audio/mp4"), "templateIds": simple_tmpl_id,
                }, content_type="multipart/form-data")
            jid = _json(r).get("id")
            job, end = {}, time.monotonic() + 120
            while jid and time.monotonic() < end:
                job = _json(client.get(f"/api/jobs/{jid}", headers=auth))
                if job.get("status") in ("done", "failed", "canceled"):
                    break
                time.sleep(0.3)
        finally:
            stt.get_engine = real_engine
        note = _json(client.get(f"/api/notes/{(job.get('noteIds') or [''])[0]}", headers=auth))
        check("queued job on overflow: draft keeps the full raw transcript as its body",
              job.get("status") == "done" and note.get("noteContentMarkdown") == note.get("noteContentRaw")
              and "minute 1" in (note.get("noteContentMarkdown") or ""),
              f"status={job.get('status')} md={str(note.get('noteContentMarkdown'))[:60]!r}")
    finally:
        oc.chat, oc.is_model_installed = real_chat, real_installed

    # (g) Thinking is turned off on every formatting call: a thinking model
    #     otherwise burns the window on hidden reasoning → empty note. Patch
    #     the client underneath chat() so the real wrapper runs.
    seen = []

    class _RecordingClient:
        def chat(self, **kw):
            seen.append(kw)
            resp = {"message": {"content": "ok"}, "done_reason": "stop", "prompt_eval_count": 10}
            return iter([resp]) if kw.get("stream") else resp

    real_client, real_installed = oc._chat_client, oc.is_model_installed
    oc._chat_client, oc.is_model_installed = _RecordingClient(), (lambda name: True)
    try:
        oc.generate_markdown(tpl, short, details, "qwen3.5:2b")
        list(oc.generate_markdown_stream(tpl, short, details, "qwen3.5:2b"))
        sid2 = _json(client.post("/api/templates", headers=auth, json={
            "name": "E2E Think Structured", "templateType": "structured", "llmModel": "qwen3.5:2b",
            "structured": {"strictness": 100, "sections": [{"id": "s1", "title": "S", "fields": [
                {"id": "f0", "type": "paragraph", "label": "F0", "variableKey": "f0",
                 "required": False, "autoFill": True, "showInSummary": True}]}]},
        })).get("id")
        client.post("/api/notes/run-structured", headers=auth, json={
            "raw_note": short, "template_id": sid2, "note_details": {**details, "template_id": sid2}}).get_data()
        check("every formatting call sends think=False (blocking, streaming, structured)",
              len(seen) >= 3 and all(kw.get("think") is False for kw in seen),
              [kw.get("think") for kw in seen])
    finally:
        oc._chat_client, oc.is_model_installed = real_client, real_installed


def _llm_batching(app, client, auth, simple_tmpl_id):
    """A transcript too long for one pass is split at turn/sentence
    boundaries, each part becomes notes, and the template is filled once from
    those notes in order — so facts from the start, middle and end all reach
    the note. Fake `chat`: extraction calls keep only the NEEDLE lines."""
    from types import SimpleNamespace
    import app.services.ollama_client as oc
    from app.services import llm_batching as lb

    details = {"note_date": datetime.utcnow().isoformat(), "participants": []}
    tpl = SimpleNamespace(name="Visit", content="# Visit\n\n{{Summarize the visit}}")
    turn = ("Speaker 1: So how have the headaches been since we last talked? Speaker 2: A bit "
            "better, two or three a week, mostly mornings, ibuprofen helps some.")

    def transcript(turns, needles, sep="\n"):
        lines = [turn] * turns
        for pos, label in needles:
            lines[int(pos * (turns - 1))] = f"Speaker 1: NEEDLE-{label} noted at this point."
        return sep.join(lines)

    # (a) Splitting: whole lines, in order, every line covered, parts within budget, overlap.
    dia = "\n".join(f"Speaker {i % 2 + 1}: turn {i} " + "word " * 25 for i in range(2000))
    parts = lb.split_transcript(dia)
    lines = dia.splitlines()
    seen, last_idx, in_order = set(), -1, True
    for p in parts:
        idx = [lines.index(l) for l in p.splitlines()]
        in_order &= idx == sorted(idx) and idx[0] <= last_idx + 1
        last_idx = idx[-1]
        seen.update(idx)
    check(f"split: {len(parts)} parts, all cut between turns, in order, nothing skipped",
          len(parts) > 1 and in_order and seen == set(range(len(lines))))
    check("split: every part within the size budget",
          all(lb._tokens(p) <= lb.PART_TOKENS + 50 for p in parts), [lb._tokens(p) for p in parts])
    check("split: each part re-reads the end of the one before (overlap)",
          all(parts[i + 1].splitlines()[0] in parts[i].splitlines() for i in range(len(parts) - 1)))
    flat = " ".join(f"Sentence {i} of an undiarized transcript." for i in range(9000))
    fparts = lb.split_transcript(flat)
    check("split: an undiarized transcript (one long line) is cut at sentence ends",
          len(fparts) > 1 and all(p.rstrip().endswith(".") for p in fparts)
          and all(lb._tokens(p) <= lb.PART_TOKENS + 50 for p in fparts), len(fparts))

    calls = []
    behavior = {"too_big_once": set(), "echo_all": False, "keep_frac": 0.0}

    def fake_chat(**kw):
        calls.append(kw)
        system, user = kw["messages"][0]["content"], kw["messages"][1]["content"]
        if system == lb.EXTRACT_SYSTEM_PROMPT:
            section = user.split("### section\n", 1)[1]
            key = section[:80]
            if key in behavior["too_big_once"]:
                behavior["too_big_once"].discard(key)
                return {"message": {"content": "- cut off"}, "done_reason": "length",
                        "prompt_eval_count": 100}
            kept = [l for l in section.splitlines() if "NEEDLE" in l or "--- Part" in l]
            filler = section[:int(len(section) * behavior["keep_frac"])]
            keep = section if behavior["echo_all"] else "\n".join(
                [f"- {l}" for l in kept] + ([f"- {filler}"] if filler else []))
            return {"message": {"content": keep or "(nothing substantive in this section)"},
                    "done_reason": "stop", "prompt_eval_count": 100}
        body = user
        if kw.get("stream"):
            return iter([{"message": {"content": "# Visit\n\n" + body[-50:]}},
                         {"message": {"content": ""}, "done": True, "done_reason": "stop",
                          "prompt_eval_count": 100}])
        return {"message": {"content": body}, "done_reason": "stop", "prompt_eval_count": 100}

    real_chat, real_installed = oc.chat, oc.is_model_installed
    oc.chat, oc.is_model_installed = fake_chat, (lambda name: True)
    try:
        fits = lb.template_fits(tpl, details)
        # (b) Short transcript: no batching, no extra calls.
        evs = list(lb.condense_iter(turn * 5, "m", fits))
        check("condense: a transcript that fits is passed through untouched (0 calls)",
              len(evs) == 1 and evs[0][1].rounds == 0 and evs[0][1].text == turn * 5 and not calls)

        # (c) ~3-hour transcript with facts at start, middle, end.
        three_h = transcript(660, [(0, "START"), (0.5, "MIDDLE"), (1, "END")])
        evs = list(lb.condense_iter(three_h, "m", fits))
        res = evs[-1][1]
        progress = [p for k, p in evs if k == "progress"]
        extract_calls = [c for c in calls if c["messages"][0]["content"] == lb.EXTRACT_SYSTEM_PROMPT]
        check(f"condense: ~3h transcript read in {res.parts} parts, one call each",
              res.rounds == 1 and res.parts >= 3 and len(extract_calls) == res.parts, (res.parts, len(extract_calls)))
        check("condense: start, middle and end facts all survive, in order",
              0 <= res.text.find("NEEDLE-START") < res.text.find("NEEDLE-MIDDLE") < res.text.find("NEEDLE-END"))
        check("condense: notes are labeled Part i of n, in order",
              all(f"--- Part {i} of {res.parts} ---" in res.text for i in range(1, res.parts + 1)))
        check("condense: progress reported per part, ending at n of n",
              progress[0]["part"] == 0 and progress[-1]["part"] == progress[-1]["parts"] == res.parts
              and [p["part"] for p in progress] == list(range(res.parts + 1)), progress)
        check("condense: each part call fits the window and caps its reply",
              all(oc.estimate_tokens(c["messages"]) + lb.EXTRACT_REPLY_TOKENS <= oc.NUM_CTX
                  and c["options"].get("num_predict") == lb.EXTRACT_REPLY_TOKENS
                  and c["options"].get("num_ctx") == oc.NUM_CTX for c in extract_calls))
        check("condense: the result fits the final template-fill prompt", fits(res.text))

        # (d) A part whose notes get cut off is split in half and redone — never kept cut off.
        calls.clear()
        first = lb.split_transcript(three_h)[0]
        behavior["too_big_once"].add(first[:80])
        res2 = list(lb.condense_iter(three_h, "m", fits))[-1][1]
        check("condense: notes cut off at the reply cap → that part is split and reread",
              res2.parts > res.parts and "cut off" not in res2.text
              and "NEEDLE-START" in res2.text, res2.parts)

        # (e) ~8h: the notes alone are still too long → a second round (notes of notes).
        calls.clear()
        behavior["keep_frac"] = 0.4
        eight_h = transcript(1760, [(0, "START"), (0.5, "MIDDLE"), (1, "END")])
        evs = list(lb.condense_iter(eight_h, "m", fits))
        res3 = evs[-1][1]
        rounds_seen = sorted({p["round"] for k, p in evs if k == "progress"})
        check(f"condense: ~8h needs a second round ({res3.parts} parts, then notes of notes)",
              res3.rounds == 2 and rounds_seen == [1, 2] and fits(res3.text), (res3.rounds, rounds_seen))
        check("condense: facts from start, middle and end survive both rounds, in order",
              0 <= res3.text.find("NEEDLE-START") < res3.text.find("NEEDLE-MIDDLE") < res3.text.find("NEEDLE-END"))
        behavior["keep_frac"] = 0.0

        # (f) Notes as long as their input can't converge.
        calls.clear()
        behavior["echo_all"] = True  # notes as long as the input → can't shrink
        try:
            list(lb.condense_iter(three_h, "m", fits))
            stuck = False
        except oc.ContextOverflow:
            stuck = True
        check("condense: notes that don't shrink the text → ContextOverflow, not a loop", stuck)
        behavior["echo_all"] = False

        # (g) /api/getMarkdown end to end.
        calls.clear()
        r = client.post("/api/getMarkdown", headers=auth, json={
            "raw_note": three_h, "note_details": {**details, "template_id": simple_tmpl_id}})
        ev = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
        stages = [e.get("stage") for e in ev]
        cond = [e for e in ev if e.get("stage") == "condensing"]
        check("getMarkdown: long transcript → condensing events, then the note streams",
              cond and stages.index("start") > stages.index("condensing") and stages[-1] == "complete"
              and "chunk" in stages, stages[:3] + ["…"] + stages[-3:])
        check("getMarkdown: condensing progress climbs to 1.0 with a readable label",
              cond[-1]["progress"] == 1.0 and cond[0]["detail"].startswith("Reading part 1 of")
              and all(a["progress"] <= b["progress"] for a, b in zip(cond, cond[1:])), cond[:2])
        final = [c for c in calls if c["messages"][0]["content"] != lb.EXTRACT_SYSTEM_PROMPT]
        user_msg = final[-1]["messages"][1]["content"] if final else ""
        check("getMarkdown: the final call reads the notes (labeled as such), not the raw transcript",
              len(final) == 1 and "### notes from the recording" in user_msg
              and "NEEDLE-END" in user_msg and turn not in user_msg)
        check("getMarkdown: complete reports how many parts it was read in",
              ev[-1].get("condensedParts") == len(cond) - 1, ev[-1].get("condensedParts"))
        r = client.post("/api/getMarkdown", headers=auth, json={
            "raw_note": turn, "note_details": {**details, "template_id": simple_tmpl_id}})
        ev = [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]
        check("getMarkdown: a normal transcript has no condensing step and condensedParts null",
              not any(e.get("stage") == "condensing" for e in ev)
              and ev[-1].get("stage") == "complete" and ev[-1].get("condensedParts") is None)
    finally:
        oc.chat, oc.is_model_installed = real_chat, real_installed


class _TextEngine:
    """Stub STT engine that 'transcribes' any file as a fixed text."""
    name = "e2e-text"

    def __init__(self, text):
        self.text = text

    def transcribe_streaming(self, wav_path, language="en", *, initial_prompt=None, batched=False):
        yield "progress", 1.0
        yield "result", (self.text, [{"start": 0.0, "end": 1.0, "text": self.text}], [])


def _llm_batching_structured_and_jobs(app, client, auth, simple_tmpl_id):
    """Step 2 of batching: structured templates (single-call and per-field)
    and queued uploads read a too-long transcript in parts too. A job that
    formats it through several templates reads it once, reports each part as
    progress, and can be canceled between parts."""
    import threading
    import time
    import app.services.ollama_client as oc
    from app.services import job_queue, llm_batching as lb, stt

    details = {"note_date": datetime.utcnow().isoformat(), "participants": []}
    turn = ("Speaker 1: So how have the headaches been since we last talked? Speaker 2: A bit "
            "better, two or three a week, mostly mornings, ibuprofen helps some.")
    lines = [turn] * 660
    lines[0] = "Speaker 2: NEEDLE-START penicillin allergy."
    lines[-1] = "Speaker 1: NEEDLE-END start propranolol."
    long_text = "\n".join(lines)

    calls = []
    gate = {"block_on": None, "entered": threading.Event(), "release": threading.Event()}

    def is_extract(kw):
        return kw["messages"][0]["content"] == lb.EXTRACT_SYSTEM_PROMPT

    def fake_chat(**kw):
        calls.append(kw)
        if is_extract(kw):
            n = sum(1 for c in calls if is_extract(c))
            if gate["block_on"] == n:
                gate["entered"].set()
                gate["release"].wait(30)
            section = kw["messages"][1]["content"]
            kept = [f"- {l}" for l in section.splitlines() if "NEEDLE" in l or "--- Part" in l]
            return {"message": {"content": "\n".join(kept) or "(nothing substantive in this section)"},
                    "done_reason": "stop", "prompt_eval_count": 100}
        user = kw["messages"][1]["content"]
        found = " ".join(w for w in ("NEEDLE-START", "NEEDLE-END") if w in user)
        resp = {"message": {"content": f"filled: {found}"}, "done_reason": "stop", "prompt_eval_count": 100}
        return iter([resp]) if kw.get("stream") else resp

    def structured_tmpl(name, mode_fields):
        return _json(client.post("/api/templates", headers=auth, json={
            "name": name, "templateType": "structured", "llmModel": "gemma3:4b",
            "structured": {"strictness": 100, "mode": mode_fields[0], "sections": [{"id": "s1", "title": "S", "fields": [
                {"id": f"f{i}", "type": "paragraph", "label": f"F{i}", "variableKey": f"f{i}",
                 "required": False, "autoFill": True, "showInSummary": True} for i in range(mode_fields[1])]}]},
        })).get("id")

    def run_structured(sid, text):
        r = client.post("/api/notes/run-structured", headers=auth, json={
            "raw_note": text, "template_id": sid, "note_details": {**details, "template_id": sid}})
        return [json.loads(l) for l in r.get_data(as_text=True).splitlines() if l.strip()]

    real_chat, real_installed, real_engine = oc.chat, oc.is_model_installed, stt.get_engine
    real_update = job_queue._ProgressWriter.update
    oc.chat, oc.is_model_installed = fake_chat, (lambda name: True)
    try:
        # (a) Structured, both modes.
        from app.routes import transcription as tr
        for label in ("single-call", "per-field"):
            sid = structured_tmpl(f"E2E Batch {label}", ("single" if label == "single-call" else "per-field", 3))
            real_mode = tr._structured_mode_for_template
            tr._structured_mode_for_template = lambda t, m=label: m
            calls.clear()
            try:
                ev = run_structured(sid, long_text)
            finally:
                tr._structured_mode_for_template = real_mode
            stages = [e.get("stage") for e in ev]
            extracts = [c for c in calls if is_extract(c)]
            fills = [c for c in calls if not is_extract(c)]
            check(f"run-structured ({label}): long transcript → condensing, then the fill, then complete",
                  "condensing" in stages and stages[-1] == "complete"
                  and ev[-1].get("condensedParts") == len(extracts) > 1, stages[:3] + ["…"] + stages[-2:])
            check(f"run-structured ({label}): every fill call reads the notes, not the raw transcript",
                  fills and all("NEEDLE-START" in c["messages"][1]["content"]
                                and "NEEDLE-END" in c["messages"][1]["content"]
                                and turn not in c["messages"][1]["content"] for c in fills),
                  len(fills))
            if label == "per-field":
                check("run-structured (per-field): transcript read in parts once, not once per field",
                      len(fills) == 3 and len(extracts) == ev[-1].get("condensedParts"), (len(fills), len(extracts)))
                check("run-structured (per-field): fields are told they're reading notes",
                      all("### Transcript (as notes)" in c["messages"][1]["content"] for c in fills))

        # (b) Queued upload through two templates: read once, shared, progress per part.
        tid2 = _json(client.post("/api/templates", headers=auth, json={
            "name": "E2E Batch Second", "content": "# Second\n\n{{Summarize}}", "llmModel": "gemma3:4b",
        })).get("id")
        from app.models import Template
        with app.app_context():
            for t in (simple_tmpl_id, tid2):
                Template.query.get(t).llm_model = "gemma3:4b"
            from app.extensions import db as _db
            _db.session.commit()
        stt.get_engine = lambda name=None: _TextEngine(long_text)
        stages_seen = []

        def spy(self, progress=None, stage=None, *, force=False):
            if stage:
                stages_seen.append(stage)
            return real_update(self, progress, stage, force=force)

        job_queue._ProgressWriter.update = spy
        path = _make_long_audio(1)

        def submit():
            with open(path, "rb") as f:
                r = client.post("/api/jobs/transcribe", headers=auth, data={
                    "audio": (f, "long-visit.m4a", "audio/mp4"), "templateIds": [simple_tmpl_id, tid2],
                }, content_type="multipart/form-data")
            return _json(r).get("id")

        def wait(jid, until=("done", "failed", "canceled")):
            job, end = {}, time.monotonic() + 120
            while time.monotonic() < end:
                job = _json(client.get(f"/api/jobs/{jid}", headers=auth))
                if job.get("status") in until:
                    break
                time.sleep(0.2)
            return job

        calls.clear()
        job = wait(submit())
        extracts = [c for c in calls if is_extract(c)]
        fills = [c for c in calls if not is_extract(c)]
        part_stages = [s for s in stages_seen if "· part" in s]
        check("queued job: long transcript through 2 templates → done with 2 drafts",
              job.get("status") == "done" and len(job.get("noteIds") or []) == 2, job.get("status"))
        check("queued job: transcript read in parts once and shared by both templates",
              len(extracts) > 1 and len(fills) == 2
              and len(extracts) == len(lb.split_transcript(long_text)), (len(extracts), len(fills)))
        notes = [_json(client.get(f"/api/notes/{nid}", headers=auth)) for nid in job.get("noteIds") or []]
        check("queued job: both drafts built from the notes (start and end facts present)",
              notes and all(n.get("noteContentMarkdown") == "filled: NEEDLE-START NEEDLE-END"
                            and n.get("noteContentRaw") == long_text for n in notes),
              [n.get("noteContentMarkdown") for n in notes])
        check("queued job: both drafts record how many parts the AI read them in",
              notes and all(n.get("condensedParts") == len(extracts) for n in notes),
              [n.get("condensedParts") for n in notes])
        check("queued job: each part shows in the job's stage ('formatting (1/2) · part i of n')",
              part_stages and part_stages[0].startswith("formatting (1/2) · part 1 of"), part_stages[:3])

        # (c) Cancel between parts: no drafts, job ends canceled.
        calls.clear()
        gate.update(block_on=2)
        gate["entered"].clear(); gate["release"].clear()
        jid = submit()
        entered = gate["entered"].wait(60)
        r = client.post(f"/api/jobs/{jid}/cancel", headers=auth)
        gate["release"].set()
        job = wait(jid, until=("canceled", "done", "failed"))
        time.sleep(0.5)
        extracts = [c for c in calls if is_extract(c)]
        check("queued job: cancel while reading parts → canceled, no drafts, stops reading",
              entered and r.status_code == 200 and job.get("status") == "canceled"
              and not job.get("noteIds") and len(extracts) <= 3, (job.get("status"), len(extracts)))
        gate.update(block_on=None)

        # (d) Notes API stores the part count; a plain edit keeps it, a
        #     re-format reports it (or clears it); junk is ignored.
        base = {"authorName": "E2E", "noteDate": details["note_date"], "noteContentRaw": "raw",
                "noteContentMarkdown": "md", "participants": []}
        made = _json(client.post("/api/notes", headers=auth, json={**base, "condensedParts": 6}))
        got = _json(client.get(f"/api/notes/{made.get('id')}", headers=auth))
        check("POST /api/notes saves condensedParts and GET returns it",
              made.get("condensedParts") == 6 and got.get("condensedParts") == 6, (made.get("condensedParts"), got.get("condensedParts")))
        client.put(f"/api/notes/{made['id']}", headers=auth, json={"noteContentMarkdown": "edited"})
        kept = _json(client.get(f"/api/notes/{made['id']}", headers=auth)).get("condensedParts")
        client.put(f"/api/notes/{made['id']}", headers=auth, json={"noteContentMarkdown": "reformatted", "condensedParts": None})
        cleared = _json(client.get(f"/api/notes/{made['id']}", headers=auth)).get("condensedParts")
        check("PUT: a plain edit keeps condensedParts; a single-pass re-format clears it",
              kept == 6 and cleared is None, (kept, cleared))
        junk = [_json(client.post("/api/notes", headers=auth, json={**base, "condensedParts": v})).get("condensedParts")
                for v in ("lots", True, -2, 0)]
        plain = _json(client.post("/api/notes", headers=auth, json=base)).get("condensedParts")
        check("condensedParts: junk values and a normal note store null", junk == [None] * 4 and plain is None, (junk, plain))
    finally:
        oc.chat, oc.is_model_installed, stt.get_engine = real_chat, real_installed, real_engine
        job_queue._ProgressWriter.update = real_update
        gate["release"].set()


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
