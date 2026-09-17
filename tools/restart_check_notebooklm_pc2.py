"""Scoped restart acceptance check, run on PC2 without exporting credentials."""
import json
from pathlib import Path
import sqlite3
import subprocess
import time

root = Path.home() / "notebooklm-hub"


def read_state():
    try:
        return json.loads((root / "runtime-status.json").read_text())
    except (OSError, ValueError):
        return {}


def service_pids():
    result = subprocess.run(
        ["systemctl", "--user", "show", "--type=service",
         "--property=Id,MainPID"], capture_output=True, text=True,
        check=True, timeout=15,
    )
    services = {}
    for block in result.stdout.strip().split("\n\n"):
        fields = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if fields.get("Id") != "notebooklm-hub.service":
            services[fields.get("Id")] = fields.get("MainPID")
    return services


def start_restart():
    before = read_state()
    if before.get("registered") is not True:
        raise RuntimeError("A registered baseline is required")
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
            print(json.dumps({"ok": False, "active_jobs": active, "restarted": False}))
            return
    other_services = service_pids()
    snapshot = root / "restart-check.json"
    snapshot.write_text(json.dumps({
        "before": before, "other_services": other_services, "started": time.time()
    }))
    snapshot.chmod(0o600)
    # The command bridge has its own short execution deadline. Request a
    # restart and return immediately; inspect recovery in a separate command.
    subprocess.run(["systemctl", "--user", "--no-block", "restart", "notebooklm-hub.service"],
                   capture_output=True, check=True, timeout=15)
    print(json.dumps({"restart_requested": True, "full_pc_restart": False}))


def check():
    snapshot = json.loads((root / "restart-check.json").read_text())
    before = snapshot["before"]
    after = read_state()
    recovered = bool(after.get("registered") and after.get("generation", 0) > before["generation"])
    print(json.dumps({
        "ok": recovered,
        "state": after.get("state"),
        "previous_generation": before["generation"],
        "generation": after.get("generation"),
        "endpoint_changed": after.get("endpoint") != before.get("endpoint") if recovered else None,
        "other_user_service_pids_unchanged": service_pids() == snapshot["other_services"],
        "elapsed_seconds": round(time.time() - snapshot["started"]),
        "full_pc_restart": False,
    }))


if __name__ == "__main__":
    try:
        check()
    except Exception as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__}))