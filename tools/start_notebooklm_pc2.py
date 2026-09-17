"""Supervise the PC2 API and its authenticated HTTPS quick tunnel.

The tunnel address is ephemeral.  Once both the local API and the public
HTTPS address answer the Hub status endpoint, this process publishes the
address to the durable AGY registry.  A registry outage must never cause a
new tunnel to be created: the same endpoint and generation are retried until
the registry recovers.

Only the two children started by this process are ever terminated.  Secrets
are read from the private ``hub-env.json`` and are not included in status
files, command lines, or exception text.
"""

import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
DEFAULT_REGISTRY_URL = (
    "https://agy-ide-production.up.railway.app/api/notebooklm/endpoint"
)
REGISTRY_INTERVAL_SECONDS = 60
REGISTRY_TIMEOUT_SECONDS = 65
STATUS_TIMEOUT_SECONDS = 45
children = []
stopping = False


class NoRedirect(HTTPRedirectHandler):
    """Make redirects an error rather than silently forwarding a token."""

    def redirect_request(self, request, *_args, **_kwargs):
        raise RuntimeError("redirect refused")


class RegistryError(RuntimeError):
    """A deliberately non-sensitive registration error."""


def _write_private_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)


def status(**fields):
    """Write public operational state without credentials or raw errors."""

    _write_private_json(ROOT / "runtime-status.json", fields)


def load_config(path=None):
    path = path or ROOT / "hub-env.json"
    if not path.is_file():
        raise RuntimeError("Falta la configuración privada del Hub.")
    path.chmod(0o600)
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise RuntimeError("La configuración privada del Hub no es válida.")
    if not isinstance(config, dict):
        raise RuntimeError("La configuración privada del Hub no es válida.")
    # The new name wins; the old name remains a migration alias.
    token = config.get("CONEXION_NOTEBOOK_PUENTE")
    if not isinstance(token, str) or not token:
        token = config.get("SGN_SECRET_TOKEN")
    if not isinstance(token, str) or not token:
        raise RuntimeError("Falta la configuración privada del Hub.")
    return config, token


def registry_url(config):
    """Return a validated registry endpoint, never an HTTP/redirect target."""

    value = config.get("NOTEBOOKLM_REGISTRY_URL", DEFAULT_REGISTRY_URL)
    if not isinstance(value, str) or not value:
        raise RuntimeError("NOTEBOOKLM_REGISTRY_URL no es válido.")
    parsed = urlsplit(value)
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("NOTEBOOKLM_REGISTRY_URL debe ser HTTPS.")
    path = parsed.path.rstrip("/")
    expected = "/api/notebooklm/endpoint"
    if path in ("", "/"):
        path = expected
    if path != expected:
        raise RuntimeError("NOTEBOOKLM_REGISTRY_URL no es un destino válido.")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def cloudflared_path():
    """Use an installed local binary, or a global cloudflared binary."""

    local = ROOT / "cloudflared"
    if local.is_file() and os.access(local, os.X_OK):
        return str(local)
    global_binary = shutil.which("cloudflared")
    if global_binary:
        return global_binary
    raise RuntimeError("No se encontró cloudflared.")


def _open(request, timeout=15):
    return build_opener(NoRedirect).open(request, timeout=timeout)


def status_ready(url, token):
    """Verify the Hub status contract without following redirects."""

    request = Request(
        url.rstrip("/") + "/api/notebooklm/status",
        headers={"X-SGN-Token": token, "Accept": "application/json"},
        method="GET",
    )
    try:
        with _open(request, timeout=STATUS_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, OSError, ValueError, RuntimeError):
        return False
    return isinstance(payload, dict) and payload.get("configured") is True


def tunnel_generation(endpoint, path=None, now_ms=None):
    """Persist one monotonic generation for this tunnel lifetime.

    A restart always gets a generation newer than the last one written, even
    when two starts happen in the same millisecond.  Registration retries use
    this same file and therefore never accidentally regress the generation.
    """

    path = path or ROOT / "tunnel-generation.json"
    previous = 0
    try:
        previous_value = json.loads(path.read_text(encoding="utf-8"))
        previous = int(previous_value.get("generation", 0))
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    current = int(now_ms if now_ms is not None else time.time() * 1000)
    generation = max(1, current, previous + 1)
    _write_private_json(path, {"endpoint": endpoint, "generation": generation})
    return generation


def register_endpoint(url, token, endpoint, generation):
    """Register and strictly validate the AGY transport response."""

    body = json.dumps({"endpoint": endpoint, "generation": generation}).encode()
    request = Request(
        url,
        data=body,
        headers={
            "X-SGN-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with _open(request, timeout=REGISTRY_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise RegistryError("registry returned an unexpected status")
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        # Do not expose the response body: it could contain infrastructure
        # details or an accidentally reflected credential.
        raise RegistryError("registry request failed") from None
    except (URLError, OSError, ValueError, RuntimeError):
        raise RegistryError("registry request failed") from None
    if not (
        isinstance(result, dict)
        and result.get("ok") is True
        and result.get("endpoint") == endpoint
        and result.get("generation") == generation
        and result.get("transportVersion") == 1
        and result.get("updatedAt")
    ):
        raise RegistryError("registry response is invalid")
    return result


class RegistryRegistrar:
    """Schedule retries without ever changing the live tunnel identity."""

    def __init__(self, url, token, endpoint, generation):
        self.url = url
        self.token = token
        self.endpoint = endpoint
        self.generation = generation
        self.retry_delay = 1
        self.next_attempt = 0.0

    def attempt(self, now):
        if now < self.next_attempt:
            return None
        try:
            result = register_endpoint(
                self.url, self.token, self.endpoint, self.generation
            )
        except RegistryError:
            self.next_attempt = now + self.retry_delay
            self.retry_delay = min(self.retry_delay * 2, 60)
            raise
        self.retry_delay = 1
        self.next_attempt = now + REGISTRY_INTERVAL_SECONDS
        return result


def stop(_signum=None, _frame=None):
    """Signal only children created by this supervisor."""

    global stopping
    stopping = True
    for child in list(children):
        if child.poll() is None:
            try:
                child.terminate()
            except OSError:
                pass


def _reap_children():
    for child in list(children):
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                child.kill()
            except OSError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass


def _wait_ready(url, token, child, label, timeout=180):
    status(state=label)
    deadline = time.monotonic() + timeout
    while not stopping and child.poll() is None and time.monotonic() < deadline:
        if status_ready(url, token):
            return True
        time.sleep(2)
    return False


def run():
    global children, stopping
    stopping = False
    children = []
    os.umask(0o077)
    os.chdir(ROOT)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    config_path = ROOT / "hub-env.json"
    config, token = load_config(config_path)
    destination = registry_url(config)
    tunnel_binary = cloudflared_path()
    status(state="starting_tunnel")
    with (ROOT / "tunnel.log").open("w") as log:
        tunnel = subprocess.Popen(
            [tunnel_binary, "tunnel", "--url", "http://127.0.0.1:8086",
             "--no-autoupdate"],
            stdout=log,
            stderr=subprocess.STDOUT,
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

        generation = tunnel_generation(endpoint)
        config["HUB_ENDPOINT_URL"] = endpoint
        _write_private_json(config_path, config)
        with (ROOT / "hub.log").open("a") as hub_log:
            hub = subprocess.Popen(
                [sys.executable, str(ROOT / "run-hub.py")],
                stdout=hub_log,
                stderr=subprocess.STDOUT,
            )
            children.append(hub)
            if not _wait_ready(
                "http://127.0.0.1:8086", token, hub, "waiting_hub"
            ):
                if stopping:
                    return
                raise RuntimeError("El Hub local no alcanzó estado listo.")
            if not _wait_ready(endpoint, token, hub, "waiting_https"):
                if stopping:
                    return
                raise RuntimeError("El túnel HTTPS no alcanzó estado listo.")

            registered = False
            registrar = RegistryRegistrar(
                destination, token, endpoint, generation
            )
            while not stopping and hub.poll() is None and tunnel.poll() is None:
                now = time.monotonic()
                if now >= registrar.next_attempt:
                    try:
                        registrar.attempt(now)
                    except RegistryError as error:
                        registered = False
                        status(
                            state="registry_retry_failure",
                            endpoint=endpoint,
                            generation=generation,
                            registered=False,
                            registry_error_type=type(error).__name__,
                        )
                    else:
                        registered = True
                        status(
                            state="registered",
                            endpoint=endpoint,
                            generation=generation,
                            registered=True,
                            api_only=True,
                            news_enabled=False,
                            address_type="registered-dynamic",
                            next_registration_seconds=REGISTRY_INTERVAL_SECONDS,
                        )
                time.sleep(
                    min(
                        1,
                        max(0.05, registrar.next_attempt - time.monotonic()),
                    )
                )
            if not stopping:
                raise RuntimeError("El servicio o el túnel se detuvo.")


if __name__ == "__main__":
    try:
        run()
    except Exception as error:
        # Only a type is safe to publish; exception text can contain a URL or
        # a library-provided diagnostic that was not intended for this file.
        status(state="error", error_type=type(error).__name__)
        sys.exit(1)
    finally:
        stop()
        _reap_children()