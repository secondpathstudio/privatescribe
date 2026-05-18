# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the embedded PrivateScribe backend.

Builds a self-contained `dist/privatescribe-backend/` directory that
electron-builder can drop into the packaged .app's Resources/. The
binary is spawned by electron/backend-process.ts.

Onedir (not onefile) by design: native deps (sqlcipher, ctranslate2,
torch, etc.) load faster, start up faster, and are far easier to
debug when something's missing.
"""
import os

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)

block_cipher = None


# ---------- hidden imports ----------
# Our own package: PyInstaller traces from main.py but dynamic blueprint
# wiring and string-based dispatches can hide modules from its analysis.
hidden_imports = collect_submodules('app')

# Flask + extensions
for pkg in (
    'flask',
    'flask_sqlalchemy',
    'flask_jwt_extended',
    'flask_migrate',
    'flask_limiter',
    'flask_cors',
    'sqlalchemy',
    'sqlalchemy.dialects.sqlite',
):
    hidden_imports += collect_submodules(pkg)

# Heavyweights — pyannote and transformers do plugin-style discovery that
# PyInstaller misses, so we eagerly walk their submodule trees.
hidden_imports += collect_submodules('pyannote')
hidden_imports += collect_submodules('huggingface_hub')

# Misc explicit imports that aren't picked up
hidden_imports += [
    'waitress',
    'sqlcipher3',
    'sqlcipher3.dbapi2',
    'dotenv',
    'ollama',
    'pydub',
    'imageio_ffmpeg',
    'httpx',
]


# ---------- native libraries ----------
binaries = []
binaries += collect_dynamic_libs('sqlcipher3')
binaries += collect_dynamic_libs('ctranslate2')
binaries += collect_dynamic_libs('tokenizers')
binaries += collect_dynamic_libs('onnxruntime')
binaries += collect_dynamic_libs('av')
binaries += collect_dynamic_libs('torch')
binaries += collect_dynamic_libs('torchaudio')


# ---------- bundled data files ----------
# faster-whisper ships small auxiliary files alongside the package.
# pyannote and torch ship config JSONs/YAMLs/version files that load by
# relative path at runtime — without these, imports fail.
datas = []
datas += collect_data_files('faster_whisper')
datas += collect_data_files('torch')
datas += collect_data_files('torchaudio')
datas += collect_data_files('pyannote.audio')
datas += collect_data_files('pyannote.core')
datas += collect_data_files('pyannote.database')
datas += collect_data_files('pyannote.pipeline')
datas += collect_data_files('huggingface_hub')
# imageio-ffmpeg carries a static ffmpeg binary under its `binaries/` dir;
# pydub shells out to it to decode uploaded audio. collect_data_files grabs
# the binary — the packaged app has no system ffmpeg, and app/services/ffmpeg.py
# restores its executable bit at runtime (collect_data_files drops it).
datas += collect_data_files('imageio_ffmpeg')


# ---------- excludes ----------
# Trim things we don't need to keep the bundle from being even larger.
excludes = [
    'tkinter',
    'matplotlib.tests',
    'numpy.tests',
    'scipy.tests',
    'pandas.tests',
    'PIL.tests',
    # sklearn is pulled in transitively by pyannote (clustering). Its test
    # package was missing from this list — added for consistency.
    'sklearn.tests',
    'sklearn.datasets.tests',
]


# ---------- local PyInstaller hooks ----------
# pyinstaller-hooks/ holds project-local hooks — currently a workaround for a
# scipy + PyInstaller + Python 3.12 crash that otherwise breaks diarized
# transcription in the packaged app. See the hook file for the full writeup.
hookspath = [os.path.join(SPECPATH, 'pyinstaller-hooks')]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=hookspath,
    runtime_hooks=[],
    excludes=excludes,
    cipher=block_cipher,
    noarchive=False,
)

# ---------- strip bundled test fixtures ----------
# Several deps — sklearn (via pyannote) most notably — ship large `tests/`
# data trees: thousands of tiny fixture files never touched at runtime.
# `excludes` above drops the test *modules*, but data files collected by
# the hooks slip through. They bloat the app and, worse, make the macOS
# signing step fragile: electron-builder runs `codesign --timestamp` once
# per bundled file, and thousands of them in a burst trip Apple's
# timestamp-server rate limit ("The timestamp service is not available").
# Dropping every data file under a `tests/` directory keeps the bundle
# lean and the signing step reliable.
a.datas = [d for d in a.datas if '/tests/' not in d[0].replace(os.sep, '/')]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='privatescribe-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # UPX compression breaks dylib loading on macOS
    console=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='privatescribe-backend',
)
