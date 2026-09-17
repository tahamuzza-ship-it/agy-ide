"""Prepare an isolated NotebookLM Hub on the user's Linux PC; never start polling.

Run only from the dedicated notebooklm-hub directory after transferring main.py
and requirements.txt. This installer never reads or writes Google credentials.
"""
import hashlib
import getpass
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request
import argparse

ROOT = Path(__file__).resolve().parent
os.umask(0o077)


def status(state, **details):
    temp = ROOT / "setup-status.json.tmp"
    temp.write_text(json.dumps({"state": state, **details}), encoding="utf-8")
    temp.chmod(0o600)
    temp.replace(ROOT / "setup-status.json")
    (ROOT / "setup-status.json").chmod(0o600)


def service_unit():
    """Return a user unit that owns only the NotebookLM Hub supervisor."""

    python = sys.executable
    script = ROOT / "start_notebooklm_pc2.py"
    path = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
    return f"""[Unit]
Description=NotebookLM Hub and HTTPS tunnel (PC2)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={ROOT}
ExecStart={python} {script}
Restart=always
RestartSec=10
UMask=0077
Environment=PATH={path}
NoNewPrivileges=true

[Install]
WantedBy=default.target
"""


def install_service():
    """Install and enable only the scoped user service.

    Linger is observed, not changed: enabling linger would affect the user's
    complete systemd session and is outside this installer's ownership.
    """

    service_dir = Path.home() / ".config" / "systemd" / "user"
    service_dir.mkdir(parents=True, exist_ok=True)
    unit = service_dir / "notebooklm-hub.service"
    temporary = unit.with_suffix(".tmp")
    temporary.write_text(service_unit(), encoding="utf-8")
    temporary.chmod(0o644)
    temporary.replace(unit)
    linger = "unknown"
    try:
        result = subprocess.run(
            ["loginctl", "show-user", getpass.getuser(), "-p", "Linger", "--value"],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0:
            linger = result.stdout.strip().lower() or "unknown"
    except (OSError, subprocess.SubprocessError):
        pass
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True, timeout=30)
    subprocess.run(
        ["systemctl", "--user", "enable", "notebooklm-hub.service"],
        check=True,
        timeout=30,
    )
    # Start is deliberately scoped to this unit, so preparation does not
    # require a reboot and does not touch PC1, PC3, or unrelated services.
    subprocess.run(
        ["systemctl", "--user", "start", "notebooklm-hub.service"],
        check=True,
        timeout=30,
    )
    status("service_installed", service=True, enabled=True, linger=linger)


def cloudflared_binary():
    """Prefer the dedicated verified binary before searching global PATH."""

    local = ROOT / "cloudflared"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    return shutil.which("cloudflared")


def prepare(install_service_option=False):
    if ROOT.name != "notebooklm-hub":
        raise RuntimeError("Use the dedicated notebooklm-hub directory.")
    packages = ROOT / "packages"
    # --target leaves global Python packages and other SGN applications intact.
    # Existing package trees are retained on upgrades; in particular this
    # avoids reinstalling dependencies merely to install/update the service.
    if not packages.is_dir() or not any(packages.iterdir()):
        status("installing_dependencies")
        subprocess.run([
            sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
            "--no-input", "--target", str(packages), "-r", str(ROOT / "requirements.txt"),
        ], check=True, timeout=1200)

    status("preparing_tunnel")
    tunnel = cloudflared_binary()
    if not tunnel:
        arch = {"x86_64": "amd64", "aarch64": "arm64"}.get(platform.machine())
        if not arch:
            raise RuntimeError("Unsupported Cloudflare Tunnel architecture.")
        req = urllib.request.Request(
            "https://api.github.com/repos/cloudflare/cloudflared/releases/latest",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "SGN-NotebookLM-Setup"},
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            release = json.load(response)
        name = f"cloudflared-linux-{arch}"
        asset = next(item for item in release["assets"] if item["name"] == name)
        digest = asset.get("digest", "")
        if not digest.startswith("sha256:") or len(digest) != 71:
            raise RuntimeError("Cloudflare release has no verifiable SHA-256 digest.")
        url = asset["browser_download_url"]
        if not url.startswith("https://github.com/cloudflare/cloudflared/releases/download/"):
            raise RuntimeError("Unexpected Cloudflare download origin.")
        target = ROOT / "cloudflared"
        partial = ROOT / "cloudflared.download"
        sha = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(url, timeout=120) as source, partial.open("wb") as output:
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > 150 * 1024 * 1024:
                    raise RuntimeError("Cloudflare download exceeds size limit.")
                sha.update(chunk)
                output.write(chunk)
        if sha.hexdigest() != digest.removeprefix("sha256:"):
            partial.unlink(missing_ok=True)
            raise RuntimeError("Cloudflare download failed integrity verification.")
        partial.replace(target)
        target.chmod(0o700)
        tunnel = str(target)

    # Authentication stays on PC2 in the existing NotebookLM profile.
    # No token, channel, Google cookie or password is created/copied here.
    launcher = ROOT / "run-hub.py"
    launcher.write_text(
        "import json, os, pathlib, sys\n"
        "root = pathlib.Path(__file__).resolve().parent\n"
        "config = root / 'hub-env.json'\n"
        "if not config.is_file(): raise SystemExit('Falta la configuración privada del Hub.')\n"
        "os.environ.update({k: str(v) for k, v in json.loads(config.read_text()).items()})\n"
        "os.environ['PYTHONPATH'] = str(root / 'packages')\n"
        "os.environ['PATH'] = str(root / 'packages' / 'bin') + os.pathsep + os.environ['PATH']\n"
        "os.chdir(root)\n"
        "os.execv(sys.executable, [sys.executable, str(root / 'main.py'), '--api-only', '--host', '127.0.0.1', '--port', '8086'])\n",
        encoding="utf-8",
    )
    env = dict(os.environ, PYTHONPATH=str(packages))
    subprocess.run(
        [sys.executable, "-c", "import flask, telebot, edge_tts, imageio_ffmpeg, notebooklm"],
        env=env, check=True, timeout=30,
    )
    subprocess.run([tunnel, "--version"], check=True, timeout=15)
    status("prepared", dependencies=True, cloudflared=True, started=False)
    if install_service_option:
        install_service()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--install-service",
        action="store_true",
        help="install, enable, and start the scoped user systemd service",
    )
    options = parser.parse_args()
    try:
        prepare(options.install_service)
    except Exception as error:
        # Diagnostics deliberately omit network URLs and credentials.
        status("failed", error_type=type(error).__name__,
               return_code=getattr(error, "returncode", None))
        raise SystemExit(1)