"""Supervise the PC2 API and an authenticated HTTPS quick tunnel.

Quick-tunnel addresses can change after a restart. The current public address
is written to runtime-status.json; Railway must use that exact address.
Credentials remain in hub-env.json (0600), never in command arguments or logs.
"""
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
children = []
stopping = False


def stop(_signum=None, _frame=None):
    global stopping
    stopping = True
    for child in children:
        if child.poll() is None:
            child.terminate()


def status(**fields):
    target = ROOT / "runtime-status.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(fields), encoding="utf-8")
    temp.replace(target)


def run():
    os.umask(0o077)
    os.chdir(ROOT)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    config_path = ROOT / "hub-env.json"
    config = json.loads(config_path.read_text())
    if not config.get("CONEXION_NOTEBOOK_PUENTE"):
        raise RuntimeError("Falta la configuración privada del Hub.")
    config_path.chmod(0o600)
    status(state="starting_tunnel")
    with (ROOT / "tunnel.log").open("w") as log:
        tunnel = subprocess.Popen(
            [str(ROOT / "cloudflared"), "tunnel", "--url",
             "http://127.0.0.1:8086", "--no-autoupdate"],
            stdout=log, stderr=subprocess.STDOUT,
        )
        children.append(tunnel)
        endpoint = None
        deadline = time.monotonic() + 120
        while not stopping and tunnel.poll() is None and time.monotonic() < deadline:
            text = (ROOT / "tunnel.log").read_text(errors="replace")
            found = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", text)
            if found:
                endpoint = found.group()
                break
            time.sleep(1)
        if not endpoint:
            raise RuntimeError("No se pudo establecer el túnel HTTPS.")
        # The URL is printed before its DNS record is necessarily reachable.
        # Keep the same tunnel alive while DNS propagates, rather than creating
        # a new address on every failed API startup.
        status(state="waiting_dns", endpoint=endpoint)
        deadline = time.monotonic() + 300
        while not stopping and time.monotonic() < deadline:
            try:
                socket.getaddrinfo(endpoint.removeprefix("https://"), 443)
                break
            except OSError:
                time.sleep(5)
        else:
            raise RuntimeError("El DNS del túnel HTTPS no está disponible.")
        config["HUB_ENDPOINT_URL"] = endpoint
        temporary = config_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(config))
        temporary.chmod(0o600)
        temporary.replace(config_path)
        with (ROOT / "hub.log").open("a") as hub_log:
            hub = subprocess.Popen(
                [sys.executable, str(ROOT / "run-hub.py")],
                stdout=hub_log, stderr=subprocess.STDOUT,
            )
            children.append(hub)
            status(state="running", endpoint=endpoint, api_only=True,
                   news_enabled=False, address_type="temporary")
            while not stopping and hub.poll() is None and tunnel.poll() is None:
                time.sleep(2)
            if not stopping:
                raise RuntimeError("El servicio o el túnel se detuvo.")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        status(state="error", error_type=type(error).__name__)
        sys.exit(1)
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()