"""Flask CLI commands. Registered on the app via register_cli() in the factory."""
from getpass import getpass

import click
from werkzeug.security import generate_password_hash

from app.extensions import db
from app.models import User


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


def register_cli(app):
    app.cli.add_command(create_admin)
