"""Flask CLI commands. Registered on the app via register_cli() in the factory."""
from datetime import datetime, timedelta
from getpass import getpass

import click
from flask.cli import with_appcontext
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import Note, Template, User
from app.services import settings as settings_service
from app.services.audit import log_action


@click.command("create-admin")
@click.option("--email", prompt=True, help="Admin email")
@click.option("--first-name", prompt=True, help="First name")
@click.option("--last-name", prompt=True, help="Last name")
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

    for n in notes:
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
    db.session.commit()
    click.echo(f"Purged {len(notes)} note(s) and {len(templates)} template(s).")


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


def register_cli(app):
    app.cli.add_command(create_admin)
    app.cli.add_command(purge_trash)
    app.cli.add_command(purge_audio)
