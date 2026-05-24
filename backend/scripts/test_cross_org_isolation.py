"""Cross-org tenant-isolation regression guard (roadmap Phase 8 item 10).

Proves the multi-tenant boundary: a user/org-admin in one organization cannot
read, list, search, manage, or audit another organization's data, while a
super-admin spans all and standalone stays unscoped. Self-contained — spins up
its own encrypted temp DB, builds two orgs, and asserts the whole matrix
through the *real* route functions and the ORM org-guard.

    cd backend && source venv/bin/activate
    python scripts/test_cross_org_isolation.py

Exits non-zero if any isolation check fails, so it can gate a build.
"""
import os
import secrets
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")

# Self-contained env: isolated data dir + key, no diarization prewarm.
_TMP = tempfile.mkdtemp(prefix="ps-xorg-test-")
os.environ["PRIVATESCRIBE_DATA_DIR"] = _TMP
os.environ.setdefault("SQLCIPHER_KEY", secrets.token_hex(32))
os.environ["HF_TOKEN"] = ""

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask_jwt_extended import create_access_token, verify_jwt_in_request
from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import db
from app.models import (AudioFile, Note, NoteAddendum, Organization,
                        Participant, Role, Template, User)
from app.routes.admin_audit import list_audit_log
from app.routes.users import admin_create_user, admin_reset_password, get_all_users
from app.services.audit import log_action
from app.services.template_access import shared_template_ids_for_user

PW = "Str0ng-Passw0rd!"
_results: list[tuple[str, bool]] = []


def check(label: str, passed: bool) -> None:
    _results.append((label, bool(passed)))
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")


def build_fixtures():
    """Two orgs with users, PHI, a shared role/template, and audit rows."""
    A = Organization(name="Cardiology")
    B = Organization(name="Psychiatry")
    db.session.add_all([A, B])
    db.session.flush()

    def mkuser(email, role, org, pw=False):
        u = User(email=email, first_name=email[0], last_name="X", role=role,
                 organization_id=org, password=generate_password_hash(PW) if pw else "x")
        db.session.add(u)
        return u

    f = {
        "super": mkuser("super@x", "super_admin", None, pw=True),
        "adminA": mkuser("adminA@x", "admin", A.id, pw=True),
        "adminB": mkuser("adminB@x", "admin", B.id),
        "userA": mkuser("userA@x", "user", A.id),
        "userB": mkuser("userB@x", "user", B.id),
    }
    db.session.flush()

    R = Role(name="Nurse")
    db.session.add(R)
    db.session.flush()
    f["userA"].roles.append(R)
    f["userB"].roles.append(R)

    # PHI in each org (org_stamp denormalizes organization_id from the author).
    for key, org in (("userA", A), ("userB", B)):
        u = f[key]
        n = Note(author_id=u.id, author_name=u.email, note_type="t",
                 note_content_raw="patient note", note_content_markdown="md")
        db.session.add(n)
        db.session.flush()
        db.session.add(NoteAddendum(note_id=n.id, author_id=u.id, author_name=u.email, content="addendum"))
        db.session.add(Participant(author_id=u.id, first_name="Pat"))
        db.session.add(AudioFile(author_id=u.id, original_filename="a.webm",
                                 stored_filename=f"enc-{key}", size_bytes=1))
    db.session.flush()

    # Template authored in org A, shared with the role both users hold.
    tA = Template(author_id=f["adminA"].id, name="OrgA Template",
                  template_type="simple", content="c", version=1)
    db.session.add(tA)
    db.session.flush()
    tA.shared_roles.append(R)

    db.session.commit()

    # Controlled audit rows (avoid the audit_log.view rows skewing counts).
    log_action("xorg.test", user_id=f["userA"].id, resource_type="note")
    log_action("xorg.test", user_id=f["userB"].id, resource_type="note")
    db.session.commit()

    f["A"], f["B"], f["tA"] = A.id, B.id, tA.id
    f["tokens"] = {u.email: create_access_token(identity=u.id)
                   for u in f.values() if isinstance(u, User)}
    return f


def main() -> int:
    app = create_app()
    with app.app_context():
        f = build_fixtures()
        tok = f["tokens"]

    def run_as(email, fn, *args, json=None, mode="server"):
        app.config["DEPLOYMENT_MODE"] = mode
        with app.test_request_context("/", json=json or {},
                                      headers={"Authorization": f"Bearer {tok[email]}"}):
            verify_jwt_in_request()
            r = fn(*args)
            body, code = (r if isinstance(r, tuple) else (r, getattr(r, "status_code", 200)))
            data = None
            try:
                data = body.get_json()
            except Exception:
                pass
            return code, data

    def orgs_in(email, model, mode="server"):
        # A query that FORGOT author-scoping — the org-guard must still confine it.
        app.config["DEPLOYMENT_MODE"] = mode
        with app.test_request_context("/", headers={"Authorization": f"Bearer {tok[email]}"}):
            verify_jwt_in_request()
            return sorted({r.organization_id for r in model.query.all()})

    print("\n[org-guard] forgotten-scope PHI reads are org-confined (server mode):")
    for model in (Note, Template, Participant, AudioFile, NoteAddendum):
        check(f"{model.__name__}: org-A user sees only org A",
              orgs_in("userA@x", model) == [f["A"]])
    check("Note: super-admin spans both orgs",
          orgs_in("super@x", Note) == sorted([f["A"], f["B"]]))
    check("Note: standalone mode is unscoped (guard off)",
          orgs_in("userA@x", Note, mode="standalone") == sorted([f["A"], f["B"]]))

    print("\n[users] admin user management is org-scoped (item 4):")
    _, d = run_as("adminA@x", get_all_users)
    check("getAllUsers: org-A admin sees only org-A users",
          sorted(u["email"] for u in d) == ["adminA@x", "userA@x"])
    _, d = run_as("super@x", get_all_users)
    check("getAllUsers: super-admin sees all", len(d) == 5)
    with app.app_context():
        uB = User.query.filter_by(email="userB@x").first().id
        uA = User.query.filter_by(email="userA@x").first().id
    c, _ = run_as("adminA@x", admin_reset_password, uB, json={"adminPassword": PW, "newPassword": PW + "2"})
    check("reset-password: org-A admin -> org-B user is 404", c == 404)
    c, _ = run_as("adminA@x", admin_reset_password, uA, json={"adminPassword": PW, "newPassword": PW + "2"})
    check("reset-password: org-A admin -> org-A user is 200", c == 200)
    c, _ = run_as("super@x", admin_reset_password, uB, json={"adminPassword": PW, "newPassword": PW + "2"})
    check("reset-password: super-admin -> org-B user is 200", c == 200)
    c, _ = run_as("adminA@x", admin_create_user,
                  json={"firstName": "E", "lastName": "V", "email": "evil@x", "password": PW, "role": "super_admin"})
    check("create-user: org-A admin cannot mint a super-admin (400)", c == 400)

    print("\n[audit] audit-log viewer is org-scoped (item 5):")
    _, d = run_as("adminA@x", list_audit_log, json=None)

    def audit_total(email):
        app.config["DEPLOYMENT_MODE"] = "server"
        with app.test_request_context("/?action=xorg.test",
                                      headers={"Authorization": f"Bearer {tok[email]}"}):
            verify_jwt_in_request()
            return list_audit_log().get_json()["total"]

    check("audit: org-A admin sees 1 xorg.test row", audit_total("adminA@x") == 1)
    check("audit: org-B admin sees 1 xorg.test row", audit_total("adminB@x") == 1)
    check("audit: super-admin sees both xorg.test rows", audit_total("super@x") == 2)

    print("\n[templates] role-based sharing is org-confined (item 6):")
    with app.app_context():
        uA = User.query.filter_by(email="userA@x").first().id
        uB = User.query.filter_by(email="userB@x").first().id
        seen_A = [r[0] for r in shared_template_ids_for_user(uA).all()]
        seen_B = [r[0] for r in shared_template_ids_for_user(uB).all()]
    check("sharing: org-A user sees the org-A shared template", f["tA"] in seen_A)
    check("sharing: org-B user (same role) does NOT see it (cross-org)", f["tA"] not in seen_B)

    failed = [label for label, ok in _results if not ok]
    print(f"\n{len(_results) - len(failed)}/{len(_results)} checks passed.")
    if failed:
        print("FAILED:")
        for label in failed:
            print(f"  - {label}")
        return 1
    print("OK — cross-org isolation holds.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        import shutil
        shutil.rmtree(_TMP, ignore_errors=True)
