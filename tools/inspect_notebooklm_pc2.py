"""Read only NotebookLM service metadata; never print private configuration."""
import json
from pathlib import Path
import subprocess

root = Path.home() / "notebooklm-hub"
result = {"directory_exists": root.is_dir()}
for name in ("main.py", "run-hub.py", "start_notebooklm_pc2.py",
             "install_notebooklm_pc2.py", "cloudflared", "hub-env.json"):
    target = root / name
    result[name] = {"exists": target.exists(),
                    "mode": oct(target.stat().st_mode & 0o777) if target.exists() else None}
for filename in ("runtime-status.json", "setup-status.json"):
    try:
        data = json.loads((root / filename).read_text())
        result[filename] = {k: data[k] for k in
                            ("state", "api_only", "news_enabled", "address_type",
                             "registered", "generation", "error_type") if k in data}
    except (OSError, ValueError):
        result[filename] = None
service = subprocess.run(
    ["systemctl", "--user", "show", "notebooklm-hub.service",
     "--property=ActiveState,SubState,UnitFileState,MainPID,ExecMainStartTimestamp,Restart"],
    capture_output=True, text=True, timeout=15,
)
result["service"] = service.stdout.strip()
linger = subprocess.run(["loginctl", "show-user", str(__import__("os").getuid()),
                         "--property=Linger"], capture_output=True, text=True, timeout=15)
result["linger"] = linger.stdout.strip()
print(json.dumps(result))