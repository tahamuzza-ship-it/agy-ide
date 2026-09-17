"""Upgrade only NotebookLM's supervisor from a pinned, verified public release.

Call upgrade(revision, digests) through the PC2 maintenance transport. Neither
argument contains credentials. Google and hub-env.json are never transferred.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from urllib.request import urlopen


def upgrade(revision, digests):
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Invalid release")
    names = {"start_notebooklm_pc2.py", "install_notebooklm_pc2.py"}
    if set(digests) != names:
        raise ValueError("Unexpected release files")
    root = Path.home() / "notebooklm-hub"
    if not (root / "hub-env.json").is_file() or not (root / "run-hub.py").is_file():
        raise RuntimeError("Existing NotebookLM installation required")
    config = json.loads((root / "hub-env.json").read_text())
    database = Path(config.get("NOTEBOOKLM_DB", "notebooklm.sqlite3"))
    if not database.is_absolute():
        database = root / database
    if database.is_file():
        with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
            active = db.execute(
                "SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'running')"
            ).fetchone()[0]
        if active:
            print(json.dumps({"ok": False, "reason": "notebooklm_jobs_active",
                              "active_jobs": active, "restarted": False}))
            return
    os.umask(0o077)
    # Validate all source bytes before touching the running installation.
    release = {}
    for name in sorted(names):
        url = f"https://raw.githubusercontent.com/tahamuzza-ship-it/agy-ide/{revision}/tools/{name}"
        with urlopen(url, timeout=45) as response:
            source = response.read(100_001)
        if len(source) > 100_000 or hashlib.sha256(source).hexdigest() != digests[name]:
            raise RuntimeError("Release integrity check failed")
        compile(source, name, "exec")
        release[name] = source
    for name, source in release.items():
        target = root / name
        temporary = target.with_suffix(".upgrade")
        temporary.write_bytes(source)
        temporary.chmod(0o600)
        temporary.replace(target)
    spec = importlib.util.spec_from_file_location("notebook_installer", root / "install_notebooklm_pc2.py")
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    # Do NOT run prepare(): packages, cloudflared, Google and private config
    # must stay untouched during an existing installation's service upgrade.
    installer.install_service()
    subprocess.run(["systemctl", "--user", "restart", "notebooklm-hub.service"],
                   check=True, timeout=60, capture_output=True)
    print(json.dumps({"ok": True, "release_verified": True,
                      "restarted": "notebooklm-hub.service",
                      "full_pc_restart": False}))