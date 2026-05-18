# PyInstaller hook — work around a scipy + PyInstaller + Python 3.12 crash.
#
# scipy/stats/_distn_infrastructure.py ends with this module-level cleanup:
#
#     for obj in [s for s in dir() if s.startswith('_doc_')]:
#         exec('del ' + obj)
#     del obj
#
# Under Python 3.12, when this module is frozen into PyInstaller's PYZ
# archive and executed by PyInstaller's import loader, the `for` target
# `obj` is never bound in the module namespace even though the loop runs,
# so the trailing `del obj` raises `NameError: name 'obj' is not defined`.
# The module imports fine under a plain interpreter — only the PYZ-frozen
# bytecode path is affected. PyInstaller marked this "not our bug"
# (pyinstaller/pyinstaller#7992); scipy still ships the idiom as of 1.17.
#
# Symptom in this app: any diarized transcription on the packaged desktop
# app fails with "Upload failed: name 'obj' is not defined" — pyannote
# pulls in scikit-learn, which imports scipy.stats on the diarization path.
#
# Fix: collect this one module as a plain source `.py` file on disk instead
# of compiled bytecode in the PYZ. It is then imported by CPython's normal
# source loader, which handles the idiom correctly.
module_collection_mode = 'py'
