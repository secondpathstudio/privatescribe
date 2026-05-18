"""Flask CLI commands. Registered on the app via register_cli() in the factory."""
from datetime import datetime, timedelta
from getpass import getpass

import click
from flask.cli import with_appcontext
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import Note, Template, User
from app.security import password_policy
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


def register_cli(app):
    app.cli.add_command(create_admin)
    app.cli.add_command(purge_trash)
    app.cli.add_command(purge_audio)
    app.cli.add_command(purge_orphaned_audio)
    app.cli.add_command(purge_audit_log)
    app.cli.add_command(verify_audit_log)
