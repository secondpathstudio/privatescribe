"""De-risk probe for cross-platform SQLCipher (Windows/Linux desktop build).

Proves that `sqlcipher3-wheels` can open a *keyed, encrypted* SQLite database
both as a normal import and from inside a PyInstaller-frozen onedir binary, on
every OS in the release matrix. This mirrors exactly what the backend does in
app/security/sqlcipher.py: `PRAGMA key = "x'<hex>'"` as the first statement.

Run directly (python derisk/sqlcipher_probe.py) or as the entrypoint of a
PyInstaller build. Exits non-zero with a message on any failure.

Throwaway: delete this folder (and .github/workflows/derisk-sqlcipher.yml)
once the matrix build is green.
"""
import os
import sys
import tempfile

import sqlcipher3

# A 256-bit raw hex key, same shape as the app's SQLCIPHER_KEY.
HEX = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
WRONG = "f" * 64


def pragma_key(hexkey: str) -> str:
    # Matches sqlcipher.py: PRAGMA key = "x'<hex>'"
    return 'PRAGMA key = "x\'' + hexkey + '\'"'


def main() -> None:
    db = os.path.join(tempfile.mkdtemp(), "probe.db")

    # --- write an encrypted DB ---
    c = sqlcipher3.connect(db)
    c.execute(pragma_key(HEX))
    c.execute("CREATE TABLE t (v TEXT)")
    c.execute("INSERT INTO t VALUES ('secret')")
    c.commit()
    c.close()

    # --- the file must NOT be a plaintext SQLite db ---
    with open(db, "rb") as f:
        header = f.read(16)
    if header.startswith(b"SQLite format 3"):
        sys.exit("FAIL: database is not encrypted (plaintext SQLite header)")

    # --- reopen with the correct key ---
    c = sqlcipher3.connect(db)
    c.execute(pragma_key(HEX))
    if c.execute("SELECT v FROM t").fetchone()[0] != "secret":
        sys.exit("FAIL: round-trip value mismatch")
    c.close()

    # --- wrong key must fail to read ---
    c = sqlcipher3.connect(db)
    c.execute(pragma_key(WRONG))
    try:
        c.execute("SELECT v FROM t").fetchone()
        sys.exit("FAIL: wrong key was able to read the database")
    except sqlcipher3.DatabaseError:
        pass  # expected
    c.close()

    frozen = bool(getattr(sys, "frozen", False))
    print(
        f"OK [{sys.platform}] frozen={frozen} "
        f"sqlcipher3={sqlcipher3.sqlite_version} — keyed round-trip + "
        "encryption + wrong-key rejection verified"
    )


if __name__ == "__main__":
    main()
