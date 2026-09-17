"""Prepare an isolated NotebookLM Hub on the user's Linux PC; never start polling.

Run only from the dedicated notebooklm-hub directory after transferring main.py
and requirements.txt. This installer never reads or writes Google credentials.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent
os.umask(0o077)


def status(state, **details):
    temp = ROOT / "setup-status.json.tmp"
    temp.write_text(json.dumps({"state": state, **details}), encoding="utf-8")
    temp.replace(ROOT / "setup-status.json")


def prepare():
    if ROOT.name != "notebooklm-hub":
        raise RuntimeError("Use the dedicated notebooklm-hub directory.")
    status("installing_dependencies")
    packages = ROOT / "packages"
    # --target leaves global Python packages and other SGN applications intact.
    subprocess.run([
        sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
        "--no-input", "--target", str(packages), "-r", str(ROOT / "requirements.txt"),
    ], check=True, timeout=1200)

    status("preparing_tunnel")
    tunnel = shutil.which("cloudflared")
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


if __name__ == "__main__":
    try:
        prepare()
    except Exception as error:
        # Diagnostics deliberately omit network URLs and credentials.
        status("failed", error_type=type(error).__name__,
               return_code=getattr(error, "returncode", None))
        raise