# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


hiddenimports = []
for package in (
    "backend",
    "edge_tts",
    "fastapi",
    "google.generativeai",
    "groq",
    "openai",
    "openwakeword",
    "onnxruntime",
    "pydantic",
    "sounddevice",
    "uvicorn",
):
    try:
        hiddenimports += collect_submodules(package)
    except Exception:
        pass

datas = []
for package in (
    "edge_tts",
    "fastapi",
    "openwakeword",
    "onnxruntime",
    "uvicorn",
):
    try:
        datas += collect_data_files(package)
    except Exception:
        pass


a = Analysis(
    ["backend_launcher.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    name="asuka-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="asuka-backend",
)
