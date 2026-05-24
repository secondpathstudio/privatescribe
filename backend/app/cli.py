"""Flask CLI commands. Registered on the app via register_cli() in the factory."""
import uuid
from datetime import datetime, timedelta
from getpass import getpass
from pathlib import Path

import click
from flask.cli import with_appcontext
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import Note, Template, User
from app.security import account_lockout, password_policy
from app.services import settings as settings_service
from app.services.audit import log_action


@click.command("create-admin")
@click.option("--email", prompt=True, help="Admin email")
@click.option("--first-name", prompt=True, help="First name")
@click.option("--last-name", prompt=True, help="Last name")
@with_appcontext
def create_admin(email, first_name, last_name):
    """Create an admin user."""
    if User.query.filter_by(email=email).first():
        click.echo(f"User with email {email} already exists.")
        return

    password = getpass("Enter password (input will be hidden): ")
    password_confirm = getpass("Confirm password (input will be hidden): ")

    if password != password_confirm:
        click.echo("Passwords do not match!")
        return

    # Same policy the API enforces — the CLI is not a back door around it.
    pw_err = password_policy.validate(password)
    if pw_err:
        click.echo(pw_err)
        return

    admin_user = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        role='admin',
        password=generate_password_hash(password, method='pbkdf2:sha256'),
        last_login=None,
    )

    db.session.add(admin_user)
    db.session.commit()
    click.echo(f"Admin user created with ID: {admin_user.id}")


@click.command("reset-password")
@click.option("--email", prompt=True, help="Email of the account to reset")
@with_appcontext
def reset_password(email):
    """Break-glass password reset, run at the machine.

    The offline recovery path for a forgotten password — including the sole
    admin's, which has no in-app recovery once they're locked out. Anyone able
    to run this command already holds the SQLCipher key from the .env, so it
    grants no access the operator doesn't already have. Clears any brute-force
    lockout and the force-password-change flag in the same step, so the
    recovered account can sign straight in with the password chosen here.
    """
    user = User.query.filter_by(email=email).first()
    if not user:
        click.echo(f"No user with email {email}.")
        return

    password = getpass("Enter new password (input will be hidden): ")
    password_confirm = getpass("Confirm new password (input will be hidden): ")
    if password != password_confirm:
        click.echo("Passwords do not match!")
        return

    # Same policy the API enforces — the CLI is not a back door around it.
    pw_err = password_policy.validate(password)
    if pw_err:
        click.echo(pw_err)
        return

    user.password = generate_password_hash(password, method='pbkdf2:sha256')
    user.force_password_change = False
    unlocked = account_lockout.unlock(user)
    log_action(
        'admin.password_reset',
        user_id=user.id,
        user_email=user.email,
        resource_type='user',
        resource_id=user.id,
        extra={'via': 'cli', 'target_email': user.email},
    )
    db.session.commit()
    suffix = " Brute-force lockout cleared." if unlocked else ""
    click.echo(f"Password reset for {user.email}.{suffix}")


@click.command("unlock-account")
@click.option("--email", prompt=True, help="Email of the locked account")
@with_appcontext
def unlock_account(email):
    """Clear a brute-force lockout so the account can sign in immediately.

    A locked account also unlocks itself once the lockout window passes; this
    is the manual override for when waiting that out isn't acceptable. It only
    clears the lock and the failed-attempt counter — the password is untouched.
    """
    user = User.query.filter_by(email=email).first()
    if not user:
        click.echo(f"No user with email {email}.")
        return

    was_locked = account_lockout.is_locked(user)
    had_state = account_lockout.unlock(user)
    if not had_state:
        click.echo(f"{user.email} is not locked and has no failed attempts on record. Nothing to do.")
        return

    log_action(
        'admin.account_unlock',
        user_id=user.id,
        user_email=user.email,
        resource_type='user',
        resource_id=user.id,
        extra={'via': 'cli', 'was_locked': was_locked},
    )
    db.session.commit()
    state = "Lockout cleared" if was_locked else "Failed-attempt counter cleared"
    click.echo(f"{state} for {user.email}.")


@click.command("purge-trash")
@click.option("--dry-run", is_flag=True, help="Report what would be deleted without deleting anything.")
@click.option("--force", is_flag=True, help="Run even if the 'auto purge' setting is off.")
@with_appcontext
def purge_trash(dry_run, force):
    """Permanently delete trashed notes & templates past the retention window.

    Honors the admin-configured settings: nothing is deleted unless
    `trash_auto_purge` is enabled (override with --force), and an item is only
    eligible once it has been in the trash for `trash_retention_days` days.
    Intended to be run on a schedule (cron / systemd timer). Items with no
    deletion timestamp are skipped.
    """
    auto_purge = settings_service.get_trash_auto_purge()
    retention_days = settings_service.get_trash_retention_days()

    if not auto_purge and not force:
        click.echo(
            "Auto-purge is disabled (trash_auto_purge = false); nothing to do. "
            "Re-run with --force to purge anyway."
        )
        return

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    suffix = " [dry run]" if dry_run else ""
    click.echo(
        f"Purging items moved to trash on or before {cutoff.isoformat()} "
        f"(retention: {retention_days} day(s)){suffix}."
    )

    notes = (
        Note.query
        .filter(Note.is_deleted.is_(True), Note.is_deleted_timestamp.isnot(None),
                Note.is_deleted_timestamp <= cutoff)
        .all()
    )
    templates = (
        Template.query
        .filter(Template.is_deleted.is_(True), Template.is_deleted_timestamp.isnot(None),
                Template.is_deleted_timestamp <= cutoff)
        .all()
    )

    click.echo(f"  eligible notes:     {len(notes)}")
    click.echo(f"  eligible templates: {len(templates)}")

    if dry_run:
        for n in notes:
            click.echo(f"  would delete note {n.id} (trashed {n.is_deleted_timestamp})")
        for t in templates:
            click.echo(f"  would delete template {t.id} (trashed {t.is_deleted_timestamp})")
        click.echo("Dry run — no changes made.")
        return

    if not notes and not templates:
        click.echo("Nothing eligible. Done.")
        return

    from app.services import audio_retention

    group_ids = set()
    for n in notes:
        if n.transcript_group_id:
            group_ids.add(n.transcript_group_id)
        log_action(
            'note.delete_permanent',
            resource_type='note',
            resource_id=n.id,
            extra={'transcript_group_id': n.transcript_group_id, 'via': 'purge-trash'},
        )
        db.session.delete(n)
    for t in templates:
        log_action(
            'template.delete_permanent',
            resource_type='template',
            resource_id=t.id,
            extra={'via': 'purge-trash'},
        )
        db.session.delete(t)

    # Drop the encrypted recording of any note whose group has no surviving
    # note left. Flush first so the orphan check doesn't see the notes we
    # just deleted. Gated by the same admin setting as the API delete path —
    # when off, recordings are left for `flask purge-orphaned-audio`.
    audio_deleted = 0
    if group_ids and settings_service.get_orphaned_audio_purge():
        db.session.flush()
        for gid in group_ids:
            audio_deleted += audio_retention.delete_orphaned_audio(gid, via='purge-trash')

    db.session.commit()
    click.echo(
        f"Purged {len(notes)} note(s), {len(templates)} template(s), "
        f"and {audio_deleted} orphaned audio file(s)."
    )


@click.command("purge-audio")
@click.option("--dry-run", is_flag=True, help="Report what would be deleted without deleting anything.")
@with_appcontext
def purge_audio(dry_run):
    """Permanently delete stored audio files past the retention window.

    Honors the admin-configured `audio_retention_days` setting: an audio file
    is eligible once it has been on disk that many days (measured from upload).
    0 days means retention is disabled and nothing is deleted. The owning notes
    keep their transcript text — only the playable recording is removed.
    Intended to be run on a schedule (cron / systemd timer), alongside
    `purge-trash`.
    """
    from app.services import audio_retention

    retention_days = settings_service.get_audio_retention_days()
    if retention_days <= 0:
        click.echo(
            "Audio retention is disabled (audio_retention_days = 0); nothing to do."
        )
        return

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    suffix = " [dry run]" if dry_run else ""
    click.echo(
        f"Purging audio uploaded on or before {cutoff.isoformat()} "
        f"(retention: {retention_days} day(s)){suffix}."
    )

    rows = audio_retention.purge_expired(dry_run=dry_run)
    click.echo(f"  eligible audio files: {len(rows)}")

    if dry_run:
        for r in rows:
            click.echo(f"  would delete audio {r.id} (uploaded {r.created_at})")
        click.echo("Dry run — no changes made.")
        return

    if not rows:
        click.echo("Nothing eligible. Done.")
        return

    click.echo(f"Purged {len(rows)} audio file(s).")


@click.command("purge-orphaned-audio")
@click.option("--dry-run", is_flag=True, help="Report what would be deleted without deleting anything.")
@with_appcontext
def purge_orphaned_audio(dry_run):
    """Permanently delete encrypted audio files no note references anymore.

    Sweeps two kinds of orphan:
      - recordings left behind by notes that were permanently deleted before
        orphan cleanup existed (or while it was switched off), and
      - abandoned uploads whose transcript never became a saved note.

    A recording is an orphan only once no note in its transcript group
    survives; abandoned (group-less) uploads get a 24h grace period so an
    in-progress recording is never swept. Unlike `purge-audio` this is not
    age-gated against a retention window — an orphaned recording has no note,
    so there is nothing left for a retention policy to protect. Intended to
    run on a schedule (cron / systemd timer) alongside the other purge jobs.
    """
    from app.services import audio_retention

    rows = audio_retention.purge_orphaned(dry_run=dry_run)
    suffix = " [dry run]" if dry_run else ""
    click.echo(f"Scanning stored audio for orphans{suffix}.")
    click.echo(f"  orphaned audio files: {len(rows)}")

    if dry_run:
        for r in rows:
            kind = "abandoned upload" if r.transcript_group_id is None else "deleted-note orphan"
            click.echo(f"  would delete audio {r.id} ({kind}, uploaded {r.created_at})")
        click.echo("Dry run — no changes made.")
        return

    if not rows:
        click.echo("Nothing orphaned. Done.")
        return

    click.echo(f"Purged {len(rows)} orphaned audio file(s).")


@click.command("purge-audit-log")
@click.option("--dry-run", is_flag=True, help="Report what would be archived without changing anything.")
@click.option("--force", is_flag=True, help="Run even if the 'audit auto purge' setting is off.")
@with_appcontext
def purge_audit_log(dry_run, force):
    """Archive then permanently delete audit-log rows past the retention window.

    Audit rows are append-only and tamper-evident, so they are never silently
    dropped: eligible rows are written to a JSON archive file under the data
    directory's audit-archives/ folder *before* they are deleted, and a
    watermark keeps the remaining hash chain verifiable.

    Honors the admin-configured settings: nothing happens unless
    `audit_auto_purge` is enabled (override with --force) and
    `audit_retention_days` is greater than 0 (0 = keep the trail forever).
    Intended to be run on a schedule (cron / systemd timer), alongside
    `purge-trash` and `purge-audio`.
    """
    from app.services import audit_retention

    retention_days = settings_service.get_audit_retention_days()
    if retention_days <= 0:
        click.echo(
            "Audit-log retention is disabled (audit_retention_days = 0); nothing to do."
        )
        return

    if not settings_service.get_audit_auto_purge() and not force:
        click.echo(
            "Audit-log auto-purge is disabled (audit_auto_purge = false); nothing to do. "
            "Re-run with --force to purge anyway."
        )
        return

    summary = audit_retention.archive_and_purge(dry_run=dry_run)

    suffix = " [dry run]" if dry_run else ""
    click.echo(
        f"Purging audit rows created on or before {summary['cutoff']} "
        f"(retention: {retention_days} day(s)){suffix}."
    )
    click.echo(f"  eligible rows: {summary['eligible_count']}")
    if summary.get("non_contiguous_skipped"):
        click.echo(
            f"  note: {summary['non_contiguous_skipped']} older row(s) skipped — "
            f"only a contiguous prefix of the hash chain can be purged."
        )

    if summary["eligible_count"] == 0:
        click.echo("Nothing eligible. Done.")
        return

    lo, hi = summary["seq_range"]
    if dry_run:
        click.echo(f"  would archive seq {lo}-{hi}, then delete those {summary['eligible_count']} row(s).")
        click.echo("Dry run — no changes made.")
        return

    click.echo(f"  archived seq {lo}-{hi} to {summary['archive_file']}")
    click.echo(f"Purged {summary['eligible_count']} audit row(s).")


@click.command("backup")
@click.option(
    "--out",
    required=True,
    type=click.Path(),
    help="Archive path (.tar.gz), or a directory to write a timestamped archive into.",
)
@click.option("--no-audio", is_flag=True, help="Back up the database only, skipping audio recordings.")
@click.option(
    "--keep-days",
    type=int,
    default=None,
    help="Prune older archives in the target directory past this many days "
    "(overrides the backup_retention_days setting; 0 = keep all).",
)
@with_appcontext
def backup(out, no_audio, keep_days):
    """Create an encrypted backup archive (database + audio).

    Snapshots the SQLCipher DB with VACUUM INTO (consistent, same-key-encrypted,
    safe while serving) and bundles it with the encrypted audio files into one
    gzip tar plus a checksum manifest. Both are already ciphertext — the archive
    holds no plaintext PHI.

    When --out is a directory, the archive is named with a UTC timestamp and old
    archives there are pruned per the retention window (the backup_retention_days
    setting, or --keep-days). Intended to run on a schedule (cron / systemd
    timer) alongside the purge jobs.

    The SQLCIPHER_KEY (.env) is NOT in the archive and must be backed up
    separately; without it the archive cannot be decrypted.
    """
    from app.services import backup as backup_service

    out_path = Path(out)
    prune_dir = None
    if out_path.is_dir():
        prune_dir = out_path
        out_path = out_path / backup_service.timestamped_name()

    summary = backup_service.create_backup(out_path, include_audio=not no_audio)

    log_action(
        "admin.backup_create",
        resource_type="backup",
        extra={
            "via": "cli",
            "out_path": summary["out_path"],
            "includes_audio": summary["includes_audio"],
            "audio_count": summary["audio_count"],
            "archive_bytes": summary["archive_bytes"],
        },
    )
    db.session.commit()

    mb = summary["archive_bytes"] / (1024 * 1024)
    click.echo(f"Backup written to {summary['out_path']} ({mb:.1f} MiB).")
    click.echo(f"  database snapshot: {summary['db_bytes'] / (1024 * 1024):.1f} MiB")
    if summary["includes_audio"]:
        click.echo(f"  audio recordings:  {summary['audio_count']}")
    else:
        click.echo("  audio recordings:  skipped (--no-audio)")
    click.echo(f"  sha256: {summary['archive_sha256']}")

    # Prune older archives only when writing into a directory (the scheduled
    # use). --keep-days overrides the admin-configured retention setting.
    if prune_dir is not None:
        retention = keep_days if keep_days is not None else settings_service.get_backup_retention_days()
        pruned = backup_service.prune_backups(
            prune_dir, retention, keep_current=out_path
        )
        if retention > 0:
            click.echo(
                f"  pruned {len(pruned)} archive(s) older than {retention} day(s)."
            )

    click.echo(click.style(
        "Reminder: this archive is encrypted with SQLCIPHER_KEY. Back up the "
        "key (.env) separately — without it the backup is unrecoverable.",
        fg="yellow",
    ))


@click.command("restore")
@click.argument("archive", type=click.Path(exists=True, dir_okay=False))
@click.option("--force", is_flag=True, help="Replace the existing database (moved aside, not deleted).")
@with_appcontext
def restore(archive, force):
    """Restore an encrypted backup archive created by `flask backup`.

    Verifies the manifest checksums and that the snapshot decrypts with the
    current SQLCIPHER_KEY *before* touching live data. The existing DB and audio
    are moved aside into a timestamped pre-restore-* folder (never deleted), so
    a mistaken restore is recoverable. Refuses to overwrite a live DB without
    --force. Stop the server before restoring, and restart it afterward.
    """
    from app.services import backup as backup_service

    # Release pooled connections so the on-disk DB file can be swapped cleanly.
    db.engine.dispose()
    try:
        summary = backup_service.restore_backup(Path(archive), force=force)
    except backup_service.RestoreError as e:
        raise click.ClickException(str(e))
    # Fresh connections after this point bind to the restored DB.
    db.engine.dispose()

    # Best-effort audit row in the restored DB's chain (log_action swallows
    # failures, e.g. an HMAC-key mismatch, so it can't undo a good restore).
    log_action(
        "admin.restore",
        resource_type="backup",
        extra={
            "via": "cli",
            "archive": summary["archive_path"],
            "backup_created_at": summary["created_at"],
            "pre_restore_path": summary["pre_restore_path"],
            "restored_audio": summary["restored_audio"],
        },
    )
    db.session.commit()

    click.echo(f"Restored from {summary['archive_path']}")
    click.echo(f"  backup taken: {summary['created_at']}")
    click.echo(f"  audio files restored: {summary['restored_audio']}")
    click.echo(f"  previous data moved to: {summary['pre_restore_path']}")
    click.echo(click.style(
        "Restart the server to pick up the restored database.", fg="yellow"
    ))


@click.command("verify-audit-log")
@with_appcontext
def verify_audit_log():
    """Walk the audit-log hash chain and report any tampering.

    Exits non-zero if the chain fails to verify, so it can run as a scheduled
    integrity check (cron / systemd timer) alongside purge-trash/purge-audio.
    """
    from app.services.audit import verify_chain

    result = verify_chain()
    archived = result.get('archived', 0)
    archived_note = f", {archived} archived" if archived else ""
    click.echo(
        f"Audit log: {result['total']} row(s) in table — "
        f"{result['chained']} chained, {result['legacy']} legacy (pre-chain)"
        f"{archived_note}."
    )
    if result["ok"]:
        click.echo(click.style(
            "OK — hash chain verified, no tampering detected.", fg="green"
        ))
        return

    click.echo(click.style(
        f"FAILED — {len(result['issues'])} issue(s) detected:", fg="red"
    ))
    for issue in result["issues"]:
        click.echo(f"  - {issue}")
    raise SystemExit(1)


# Sample content for `flask seed-notes`. Each entry pairs a Whisper-style raw
# transcript with its formatted Markdown, plus the template it suits and a
# workflow status. The command cycles through this list when asked for more
# notes than there are samples.
_SEED_SAMPLES = [
    {
        "name": "Follow-up — Hypertension",
        "template": "SOAP Note",
        "status": "signed",
        "raw": "patient is a 54 year old male here for blood pressure follow up "
               "feeling well no headaches no chest pain taking lisinopril daily "
               "bp today is 128 over 82 heart rate 72 lungs clear continue "
               "current dose recheck in three months",
        "md": "## Subjective\n54-year-old male presenting for hypertension "
              "follow-up. Reports feeling well with no headaches or chest pain. "
              "Adherent to daily lisinopril.\n\n## Objective\n- BP: 128/82 mmHg\n"
              "- HR: 72 bpm\n- Lungs: clear to auscultation\n\n## Assessment\n"
              "Hypertension, well controlled.\n\n## Plan\nContinue current "
              "lisinopril dose. Recheck blood pressure in three months.",
    },
    {
        "name": "New patient — Knee pain",
        "template": "SOAP Note",
        "status": "finalized",
        "raw": "thirty two year old runner reports right knee pain for two weeks "
               "worse with stairs no swelling no trauma exam shows mild "
               "tenderness over the patella full range of motion likely "
               "patellofemoral pain advised rest ice and quad strengthening",
        "md": "## Subjective\n32-year-old recreational runner with two weeks of "
              "right knee pain, worse climbing stairs. No trauma, no swelling.\n\n"
              "## Objective\n- Mild tenderness over the patella\n- Full range of "
              "motion\n- No effusion\n\n## Assessment\nPatellofemoral pain "
              "syndrome.\n\n## Plan\nRelative rest, ice after activity, quadriceps "
              "strengthening program. Follow up in four weeks if not improving.",
    },
    {
        "name": "Annual physical — J. Rivera",
        "template": "Visit Summary",
        "status": "signed",
        "raw": "annual wellness visit no new complaints diet and exercise "
               "discussed labs ordered for lipids and a1c immunizations up to "
               "date return in one year",
        "md": "# Visit Summary\n\n**Reason for visit:** Annual wellness exam\n\n"
              "**Findings:** No new complaints. Diet and exercise reviewed. "
              "Immunizations up to date.\n\n**Orders:** Lipid panel, HbA1c.\n\n"
              "**Next steps:** Return in one year for the next annual visit.",
    },
    {
        "name": "Visit — Seasonal allergies",
        "template": "Visit Summary",
        "status": "draft",
        "raw": "patient with itchy eyes and runny nose for the past month started "
               "an antihistamine with partial relief recommended adding a nasal "
               "steroid spray follow up if symptoms persist",
        "md": "# Visit Summary\n\n**Reason for visit:** Seasonal allergy "
              "symptoms\n\n**Findings:** One month of itchy eyes and rhinorrhea. "
              "Partial relief from an over-the-counter antihistamine.\n\n"
              "**Plan:** Add an intranasal corticosteroid spray.\n\n"
              "**Next steps:** Follow up if symptoms persist.",
    },
    {
        "name": "Telehealth — Medication review",
        "template": "General Note",
        "status": "finalized",
        "raw": "telehealth call to review medications patient tolerating "
               "metformin well no gi upset reports occasional missed doses "
               "discussed using a pill organizer",
        "md": "Telehealth medication review. The patient is tolerating metformin "
              "well with no GI upset. They report occasionally missing doses; we "
              "discussed using a weekly pill organizer to improve adherence.",
    },
    {
        "name": "Phone note — Lab results",
        "template": "General Note",
        "status": "signed",
        "raw": "called patient with lab results cholesterol slightly elevated "
               "a1c within normal limits advised dietary changes and recheck in "
               "six months",
        "md": "Called the patient to review lab results. Cholesterol is slightly "
              "elevated; HbA1c is within normal limits. Advised dietary changes "
              "and a recheck of the lipid panel in six months.",
    },
    {
        "name": "Weekly engineering sync",
        "template": "Meeting Summary",
        "status": "finalized",
        "raw": "team sync covered the release timeline the auth migration is on "
               "track for next friday qa flagged two blocking bugs design review "
               "scheduled for wednesday",
        "md": "# Meeting Summary\n\n**Topic:** Weekly engineering sync\n\n"
              "## Discussion\n- Release timeline reviewed\n- Auth migration on "
              "track for next Friday\n- QA flagged two blocking bugs\n\n"
              "## Action items\n- Resolve the two blocking bugs before release\n"
              "- Design review scheduled for Wednesday",
    },
    {
        "name": "Product roadmap planning",
        "template": "Meeting Summary",
        "status": "draft",
        "raw": "roadmap planning meeting prioritized the offline mode feature for "
               "q3 cloud sync pushed to q4 agreed to draft specs by end of month",
        "md": "# Meeting Summary\n\n**Topic:** Product roadmap planning\n\n"
              "## Decisions\n- Offline mode prioritized for Q3\n- Cloud sync "
              "moved to Q4\n\n## Action items\n- Draft feature specs by end of "
              "month",
    },
    {
        "name": "Standup — Tuesday",
        "template": "Standup Notes",
        "status": "draft",
        "raw": "yesterday finished the export pdf endpoint today working on the "
               "audit log viewer no blockers",
        "md": "# Standup\n\n**Yesterday:** Finished the export-to-PDF endpoint.\n\n"
              "**Today:** Working on the audit-log viewer.\n\n"
              "**Blockers:** None.",
    },
    {
        "name": "Standup — Thursday",
        "template": "Standup Notes",
        "status": "finalized",
        "raw": "yesterday wrapped up the audit log viewer today starting on the "
               "diarization settings page blocked on the hugging face token",
        "md": "# Standup\n\n**Yesterday:** Wrapped up the audit-log viewer.\n\n"
              "**Today:** Starting the diarization settings page.\n\n"
              "**Blockers:** Waiting on a Hugging Face token.",
    },
]


@click.command("seed-notes")
@click.argument("count", type=int)
@click.option("--email", help="Email of the note author (defaults to the first user).")
@with_appcontext
def seed_notes(count, email):
    """Seed COUNT sample notes for development/demo.

    Cycles through a fixed set of sample transcripts, varying the template,
    workflow status, and date so the notes table looks realistic. Each note
    gets its own transcript group; the FTS search index updates automatically
    via the mapper events in services/note_search.py.
    """
    if count <= 0:
        click.echo("COUNT must be a positive integer.")
        return

    if email:
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(f"No user with email {email}.")
            return
    else:
        user = User.query.order_by(User.created_at).first()
        if not user:
            click.echo("No users exist — run `flask create-admin` first.")
            return

    templates = {t.name: t for t in Template.query.all()}
    author_name = f"{user.first_name} {user.last_name}".strip()
    now = datetime.utcnow()

    for i in range(count):
        sample = _SEED_SAMPLES[i % len(_SEED_SAMPLES)]
        tmpl = templates.get(sample["template"])
        note_date = now - timedelta(days=3 * i, hours=2 * i)
        # Disambiguate the title once the sample list wraps around.
        cycle = i // len(_SEED_SAMPLES)
        name = sample["name"] if cycle == 0 else f"{sample['name']} ({cycle + 1})"
        status = sample["status"]
        note = Note(
            id=str(uuid.uuid4()),
            author_name=author_name,
            author_id=user.id,
            name=name,
            note_date=note_date,
            created_at=note_date,
            updated_at=note_date,
            note_content_raw=sample["raw"],
            note_content_markdown=sample["md"],
            note_type="text",
            status=status,
            template_id=tmpl.id if tmpl else None,
            transcript_group_id=str(uuid.uuid4()),
            approved_at=note_date if status in ("finalized", "signed") else None,
            signed_at=note_date if status == "signed" else None,
        )
        db.session.add(note)

    db.session.commit()
    click.echo(f"Seeded {count} sample note(s) for {user.email}.")
    click.echo(f"Total notes in DB: {Note.query.count()}")


def register_cli(app):
    app.cli.add_command(create_admin)
    app.cli.add_command(reset_password)
    app.cli.add_command(unlock_account)
    app.cli.add_command(purge_trash)
    app.cli.add_command(purge_audio)
    app.cli.add_command(purge_orphaned_audio)
    app.cli.add_command(purge_audit_log)
    app.cli.add_command(verify_audit_log)
    app.cli.add_command(backup)
    app.cli.add_command(restore)
    app.cli.add_command(seed_notes)
