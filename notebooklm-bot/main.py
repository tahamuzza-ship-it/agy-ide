"""Standalone NotebookLM Telegram bot and HTTP API.

The module deliberately contains no import-time network calls, bot creation, or
polling.  This makes the validation and service classes usable by tests and by
the AGY proxy without a Telegram token.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import concurrent.futures
import hashlib
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


VOICE = "es-ES-AlvaroNeural"
MAX_PDF_BYTES = 4 * 1024 * 1024
MAX_TELEGRAM_FILE_BYTES = 45 * 1024 * 1024
REMOTE_PUBLISHER_TIMEOUT_SECONDS = 30
MAX_JOB_QUEUE = 32
MAX_WORKERS = 2
MAX_NEWS_TEXT_UTF16 = 3500
NEWS_DRAFT_TTL_SECONDS = 30 * 60
URL_RE = re.compile(r"^https?://", re.I)


class UserError(Exception):
    """An actionable, safe-to-show error caused by user/configuration input."""


def utf16_code_units(value: str) -> int:
    """Count the units Telegram applies to its text limit (not Python chars)."""
    if not isinstance(value, str):
        return 0
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def timing_safe_equal(provided: str | bytes, expected: str | bytes) -> bool:
    """Compare secret headers without leaking timing information."""
    if isinstance(provided, str):
        provided = provided.encode("utf-8")
    if isinstance(expected, str):
        expected = expected.encode("utf-8")
    import hmac
    return hmac.compare_digest(provided, expected)


def is_private_host(hostname: str | None) -> bool:
    """Return true for localhost, local names, and all non-public IPs."""
    if not hostname:
        return True
    name = hostname.rstrip(".").lower()
    if name in {"localhost", "localhost.localdomain"} or name.endswith(".local"):
        return True
    try:
        addresses = [ipaddress.ip_address(name)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(name, None, type=socket.SOCK_STREAM)
            ]
        except (OSError, ValueError):
            # An unresolvable hostname cannot be safely fetched.
            return True
    return any(
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        or ip.is_multicast or ip.is_unspecified
        for ip in addresses
    )


def validate_public_url(value: str, *, label: str = "URL") -> str:
    """Validate an HTTP(S) public URL before handing it to NotebookLM."""
    if not isinstance(value, str) or len(value) > 4096:
        raise UserError(f"{label}: indica una URL HTTP o HTTPS válida.")
    parsed = urlparse(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise UserError(f"{label}: solo se permiten URLs HTTP/HTTPS.")
    if parsed.username or parsed.password:
        raise UserError(f"{label}: no se permiten credenciales incrustadas.")
    if is_private_host(parsed.hostname):
        raise UserError(f"{label}: no se permiten localhost ni redes privadas.")
    return value.strip()


def validate_https_url(value: str) -> str:
    parsed = urlparse(value or "")
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise UserError("HUB_ENDPOINT_URL debe ser una URL HTTPS.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or is_private_host(parsed.hostname):
        raise UserError("HUB_ENDPOINT_URL debe apuntar a un host HTTPS público.")
    return value.rstrip("/")


def validate_notebooklm_publisher_url(value: str) -> str:
    """Accept only a public HTTPS origin for the Railway publication callback."""
    parsed = urlparse(value or "")
    if (parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"} or is_private_host(parsed.hostname)):
        raise UserError(
            "NOTEBOOKLM_PUBLISHER_URL debe ser el origen HTTPS público de CiberCode."
        )
    return f"https://{parsed.netloc}"


class RemoteNotebookPublisher:
    """Authenticated, no-retry callback to Railway; it has no Telegram token."""

    def __init__(self, endpoint: str, secret: str, *, opener: Any | None = None):
        self.endpoint = validate_notebooklm_publisher_url(endpoint)
        if not secret:
            raise UserError("Falta CONEXION_NOTEBOOK_PUENTE para el publicador remoto.")
        self.secret = secret
        self.opener = opener or build_opener(_NoRedirect())

    def _request(self, method: str, pathname: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        request = Request(
            f"{self.endpoint}{pathname}", data=data, method=method,
            headers={
                "X-SGN-Token": self.secret,
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            # Railway checks three Telegram read permissions and then sends;
            # this exceeds its 5s-per-call timeout with operational margin.
            with self.opener.open(request, timeout=REMOTE_PUBLISHER_TIMEOUT_SECONDS) as response:
                raw = response.read(4096)
                if not 200 <= int(response.status) < 300:
                    raise UserError("El publicador remoto rechazó la solicitud.")
        except HTTPError as exc:
            if exc.code == 401:
                raise UserError("El publicador remoto rechazó la autenticación.") from exc
            raise UserError("El publicador remoto no pudo completar la solicitud.") from exc
        except (URLError, OSError, TimeoutError) as exc:
            raise UserError("No se pudo conectar al publicador remoto.") from exc
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UserError("El publicador remoto devolvió una respuesta inválida.") from exc
        if not isinstance(result, dict):
            raise UserError("El publicador remoto devolvió una respuesta inválida.")
        return result

    def preflight(self) -> None:
        """Read-only check made before expensive NotebookLM news work."""
        result = self._request("GET", "/api/notebooklm/publication-status")
        if result.get("ready") is not True:
            raise UserError("El canal de publicación remoto no está listo.")

    def __call__(self, text: str, draft_id: str) -> dict[str, Any]:
        """Publish one claimed draft using its durable ID as the idempotency key."""
        # The draft ID is created and durably claimed by SQLite before this
        # callback. Never substitute a new random request ID: an uncertain
        # network send must remain non-repeatable across process restarts.
        if (not isinstance(text, str) or not text
                or utf16_code_units(text) > MAX_NEWS_TEXT_UTF16):
            raise UserError(
                "La noticia supera el límite de publicación de 3500 unidades UTF-16."
            )
        if not isinstance(draft_id, str) or not re.fullmatch(r"[a-f0-9]{32}", draft_id):
            raise UserError("El identificador del borrador no es válido.")
        result = self._request("POST", "/api/notebooklm/publish", {
            "text": str(text),
            "requestId": draft_id,
            "confirmed": True,
        })
        if result.get("ok") is not True:
            raise UserError("El publicador remoto no confirmó la publicación.")
        return result


def validate_pdf_bytes(data: bytes) -> bytes:
    if not isinstance(data, bytes) or len(data) > MAX_PDF_BYTES:
        raise UserError("El PDF supera el límite de 4 MB.")
    if not data.startswith(b"%PDF-"):
        raise UserError("El archivo no parece un PDF válido (falta la firma %PDF-).")
    return data


def parse_cli_json(stdout: str) -> Any:
    """Parse JSON even when a CLI emits informational lines before the object."""
    text = (stdout or "").strip()
    if not text:
        raise UserError("NotebookLM no devolvió datos.")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        starts = [p for p in (text.find("{"), text.find("[")) if p >= 0]
        if starts:
            try:
                return json.loads(text[min(starts):])
            except json.JSONDecodeError:
                pass
    raise UserError("NotebookLM devolvió una respuesta no reconocible.")


def _first_value(data: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(data, dict):
        for key in keys:
            if key in data and data[key] not in (None, ""):
                return data[key]
        for child in data.values():
            found = _first_value(child, keys)
            if found is not None:
                return found
    elif isinstance(data, list):
        for child in data:
            found = _first_value(child, keys)
            if found is not None:
                return found
    return None


def _artifact_id(data: Any) -> str | None:
    """Extract only an artifact/task identifier from generate --json output."""
    if isinstance(data, dict):
        for key in ("artifact_id", "artifactId", "task_id", "taskId"):
            value = data.get(key)
            if isinstance(value, str) and value and len(value) <= 200 and not any(
                char in value for char in "\r\n"
            ):
                return value
        artifact = data.get("artifact")
        if isinstance(artifact, dict):
            value = artifact.get("id") or artifact.get("artifact_id")
            if isinstance(value, str) and value and len(value) <= 200 and not any(
                char in value for char in "\r\n"
            ):
                return value
        for child in data.values():
            found = _artifact_id(child)
            if found:
                return found
    elif isinstance(data, list):
        for child in data:
            found = _artifact_id(child)
            if found:
                return found
    return None


def _as_text(data: Any) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        for key in ("text", "answer", "summary", "content", "markdown", "response"):
            if isinstance(data.get(key), str):
                return data[key]
    return json.dumps(data, ensure_ascii=False, indent=2)


class SQLiteStore:
    """Small durable store for ownership, jobs and downloadable artifacts."""

    def __init__(self, path: str | Path = "notebooklm.sqlite3"):
        self.path = str(path)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        with self.lock:
            self.db.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    actor TEXT PRIMARY KEY, active_notebook_id TEXT
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
                    status TEXT NOT NULL, message TEXT, result_json TEXT,
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY, path TEXT NOT NULL, mime_type TEXT NOT NULL,
                    file_name TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS deliveries (
                    job_id TEXT PRIMARY KEY, status TEXT NOT NULL,
                    message TEXT, updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS news_drafts (
                    id TEXT PRIMARY KEY, actor TEXT NOT NULL, notebook_id TEXT NOT NULL,
                    text TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL,
                    claimed_at REAL
                );
                CREATE INDEX IF NOT EXISTS news_drafts_owner_idx
                    ON news_drafts(actor, notebook_id, expires_at);
                """
            )
            self.db.commit()
            # An interrupted process must never leave work looking successful.
            self.db.execute(
                "UPDATE jobs SET status='failed', message='Tarea interrumpida al reiniciar' "
                "WHERE status IN ('queued','running')"
            )
            self.db.execute(
                "UPDATE deliveries SET status='failed', message='Notificación interrumpida al reiniciar', "
                "updated_at=? WHERE status='delivering'", (time.time(),)
            )
            self.db.commit()
            self._cleanup_files()

    def _cleanup_files(self) -> None:
        """Bound persisted artifacts so a long-lived bot cannot fill /tmp."""
        cutoff = time.time() - 24 * 60 * 60
        with self.lock:
            rows = self.db.execute(
                "SELECT id, path FROM files ORDER BY created_at DESC"
            ).fetchall()
            remove = rows[128:]
            remove += [row for row in rows[:128] if row["id"] and
                       self.db.execute("SELECT created_at FROM files WHERE id=?",
                                       (row["id"],)).fetchone()["created_at"] < cutoff]
            seen = set()
            for row in remove:
                if row["id"] in seen:
                    continue
                seen.add(row["id"])
                try:
                    Path(row["path"]).unlink(missing_ok=True)
                except OSError:
                    pass
                self.db.execute("DELETE FROM files WHERE id=?", (row["id"],))
            self.db.commit()

    def active(self, actor: str) -> str | None:
        with self.lock:
            row = self.db.execute("SELECT active_notebook_id FROM users WHERE actor=?", (actor,)).fetchone()
            return row["active_notebook_id"] if row else None

    def set_active(self, actor: str, notebook_id: str) -> None:
        with self.lock:
            self.db.execute(
                "INSERT INTO users(actor, active_notebook_id) VALUES(?,?) "
                "ON CONFLICT(actor) DO UPDATE SET active_notebook_id=excluded.active_notebook_id",
                (actor, notebook_id),
            )
            self.db.commit()

    def create_job(self, actor: str, action: str) -> str:
        job_id = uuid.uuid4().hex
        now = time.time()
        with self.lock:
            self.db.execute(
                "INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)",
                (job_id, actor, action, "queued", None, None, now, now),
            )
            self.db.commit()
        return job_id

    def update_job(self, job_id: str, status: str, message: str | None = None,
                   result: dict[str, Any] | None = None) -> None:
        with self.lock:
            self.db.execute(
                "UPDATE jobs SET status=?, message=?, result_json=?, updated_at=? WHERE id=?",
                (status, message, json.dumps(result, ensure_ascii=False) if result else None,
                 time.time(), job_id),
            )
            self.db.commit()

    def job(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return None
        out = dict(row)
        out["result"] = json.loads(out.pop("result_json")) if out.get("result_json") else None
        delivery = self.db.execute(
            "SELECT status FROM deliveries WHERE job_id=?", (job_id,)
        ).fetchone()
        out["deliveryStatus"] = delivery["status"] if delivery else None
        # Keep the owner in canonical job data so API callers can verify origin.
        out.pop("created_at", None)
        out.pop("updated_at", None)
        return out

    def claim_delivery(self, job_id: str) -> bool:
        """Claim one immutable delivery attempt; retries cannot send twice."""
        with self.lock:
            try:
                self.db.execute(
                    "INSERT INTO deliveries(job_id,status,updated_at) VALUES(?,?,?)",
                    (job_id, "delivering", time.time()),
                )
                self.db.commit()
                return True
            except sqlite3.IntegrityError:
                return False

    def create_news_draft(self, actor: str, notebook_id: str, text: str) -> str:
        """Persist preview text before it can be shown to a caller."""
        draft_id = uuid.uuid4().hex
        now = time.time()
        with self.lock:
            self.db.execute(
                "INSERT INTO news_drafts(id,actor,notebook_id,text,created_at,expires_at,claimed_at) "
                "VALUES(?,?,?,?,?,?,NULL)",
                (draft_id, actor, notebook_id, text, now, now + NEWS_DRAFT_TTL_SECONDS),
            )
            self.db.commit()
        return draft_id

    def claim_news_draft(self, draft_id: str, actor: str, notebook_id: str) -> dict[str, Any]:
        """Atomically claim one unexpired owner-scoped draft before a send.

        A committed claim is intentionally never released, including after a
        restart or callback timeout. This makes a possibly sent message unable
        to replay.
        """
        now = time.time()
        with self.lock:
            row = self.db.execute(
                "SELECT id, actor, notebook_id, text, expires_at, claimed_at "
                "FROM news_drafts WHERE id=?", (draft_id,)
            ).fetchone()
            if not row or row["actor"] != actor or row["notebook_id"] != notebook_id:
                raise UserError("El borrador no existe para este actor y cuaderno.")
            if row["expires_at"] <= now:
                raise UserError("El borrador de noticia caducó; genera una vista previa nueva.")
            if row["claimed_at"] is not None:
                raise UserError("Este borrador ya fue reclamado y no se volverá a publicar.")
            claimed = self.db.execute(
                "UPDATE news_drafts SET claimed_at=? WHERE id=? AND actor=? AND notebook_id=? "
                "AND expires_at>? AND claimed_at IS NULL",
                (now, draft_id, actor, notebook_id, now),
            )
            self.db.commit()
            if claimed.rowcount != 1:
                # This covers concurrent processes which pass the first read.
                raise UserError("Este borrador ya fue reclamado o caducó; no se volverá a publicar.")
            return {"id": row["id"], "text": row["text"]}

    def finish_delivery(self, job_id: str, status: str, message: str | None = None) -> None:
        with self.lock:
            self.db.execute(
                "UPDATE deliveries SET status=?, message=?, updated_at=? WHERE job_id=?",
                (status, message, time.time(), job_id),
            )
            self.db.commit()

    def add_file(self, path: str, mime_type: str, file_name: str) -> str:
        file_id = uuid.uuid4().hex
        with self.lock:
            self.db.execute("INSERT INTO files VALUES(?,?,?,?,?)",
                            (file_id, path, mime_type, file_name, time.time()))
            self.db.commit()
        return file_id

    def file(self, file_id: str) -> sqlite3.Row | None:
        with self.lock:
            return self.db.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone()

    def owns_file(self, actor: str, file_id: str) -> bool:
        """Only a completed job of this caller can expose its result file."""
        expected = f"/api/notebooklm/files/{file_id}"
        with self.lock:
            rows = self.db.execute(
                "SELECT result_json FROM jobs WHERE actor=? AND status='completed' "
                "AND result_json IS NOT NULL", (actor,)
            ).fetchall()
        for row in rows:
            try:
                result = json.loads(row["result_json"])
            except (ValueError, TypeError):
                continue
            if isinstance(result, dict) and result.get("downloadUrl") == expected:
                return True
        return False

    def close(self) -> None:
        self.db.close()


class NotebookCLI:
    """Safe argv-only adapter around notebooklm-py 0.8.2."""

    def __init__(self, executable: str | None = None, timeout: int = 1800):
        self.executable = executable or shutil.which("notebooklm")
        if self.executable:
            self.prefix = [self.executable]
        else:
            self.prefix = [os.environ.get("PYTHON", "python"), "-m", "notebooklm"]
        try:
            import importlib.util
            self.available = bool(self.executable or importlib.util.find_spec("notebooklm"))
        except (ImportError, ValueError):
            self.available = bool(self.executable)
        self.timeout = timeout

    def run(self, args: list[str], *, timeout: int | None = None) -> str:
        # Never use a shell; never print stdout/stderr since CLI output may
        # contain authentication diagnostics.
        argv = self.prefix + args
        try:
            proc = subprocess.run(
                argv, shell=False, check=False, capture_output=True, text=True,
                timeout=timeout or self.timeout,
            )
        except FileNotFoundError as exc:
            raise UserError("No se encontró notebooklm. Instala notebooklm-py==0.8.2.") from exc
        except subprocess.TimeoutExpired as exc:
            raise UserError("NotebookLM tardó demasiado; inténtalo de nuevo.") from exc
        if proc.returncode:
            # CLI stderr is intentionally discarded: auth diagnostics can
            # contain cookie/profile material. Give an actionable but generic
            # message instead of reflecting it through HTTP or Telegram.
            raise UserError(
                "NotebookLM no pudo completar la operación; comprueba que "
                "ejecutaste notebooklm login y vuelve a intentarlo."
            )
        return proc.stdout

    def json(self, args: list[str], *, timeout: int | None = None) -> Any:
        return parse_cli_json(self.run(args, timeout=timeout))


class NotebookService:
    """Notebook operations shared by HTTP and Telegram frontends."""

    def __init__(self, cli: NotebookCLI | None = None, store: SQLiteStore | None = None,
                 publisher: Callable[[str], Any] | None = None):
        self.cli = cli or NotebookCLI()
        self.store = store or SQLiteStore(os.environ.get("NOTEBOOKLM_DB", "notebooklm.sqlite3"))
        self.publisher = publisher
        self._artifact_locks: dict[str, threading.Lock] = {}
        self._artifact_locks_guard = threading.Lock()

    def _artifact_lock(self, notebook_id: str) -> threading.Lock:
        with self._artifact_locks_guard:
            return self._artifact_locks.setdefault(notebook_id, threading.Lock())

    def _notebook_id(self, actor: str, supplied: str | None = None) -> str:
        value = supplied or self.store.active(actor)
        if not value:
            raise UserError("Selecciona o crea un cuaderno antes de continuar.")
        if len(value) > 200 or any(c in value for c in "\r\n"):
            raise UserError("El identificador del cuaderno no es válido.")
        return value

    def status(self) -> dict[str, Any]:
        configured = bool(getattr(self.cli, "available", getattr(self.cli, "executable", False)))
        if not configured:
            return {"configured": False, "authenticated": False,
                    "message": "Instala notebooklm-py==0.8.2 y ejecuta notebooklm login."}
        try:
            # notebooklm-py 0.8.2's machine-readable auth contract is the
            # top-level ``status`` from ``auth check --test --json``.  The
            # doctor report has nested check statuses instead, and does not
            # expose an ``authenticated`` boolean.
            data = self.cli.json(["auth", "check", "--test", "--json"], timeout=30)
            authenticated = isinstance(data, dict) and data.get("status") == "ok"
            message = "NotebookLM autenticado." if authenticated else (
                "Falta autenticación: ejecuta notebooklm login en esta máquina.")
            return {"configured": True, "authenticated": authenticated, "message": message}
        except UserError:
            # Never reflect CLI diagnostics: they may contain profile paths,
            # cookie names/values, or account identifiers.
            return {
                "configured": True,
                "authenticated": False,
                "message": (
                    "No se pudo comprobar la autenticación; ejecuta "
                    "notebooklm login en esta máquina."
                ),
            }

    def notebooks(self, actor: str) -> dict[str, Any]:
        data = self.cli.json(["list", "--json"], timeout=60)
        rows = data if isinstance(data, list) else (
            data.get("notebooks", data.get("items", [])) if isinstance(data, dict) else []
        )
        result = []
        for row in rows:
            if isinstance(row, dict):
                ident = row.get("id") or row.get("notebook_id")
                title = row.get("title") or row.get("name") or ident
                if ident:
                    result.append({"id": str(ident), "title": str(title)})
        return {"notebooks": result, "activeNotebookId": self.store.active(actor)}

    def create_notebook(self, actor: str, title: str) -> dict[str, Any]:
        title = (title or "").strip()
        if not title or len(title) > 200:
            raise UserError("El título del cuaderno debe tener entre 1 y 200 caracteres.")
        data = self.cli.json(["create", title, "--json"], timeout=120)
        ident = _first_value(data, ("id", "notebook_id"))
        if not ident:
            raise UserError("NotebookLM creó el cuaderno pero no devolvió su identificador.")
        item = {"id": str(ident), "title": str(_first_value(data, ("title", "name")) or title)}
        self.store.set_active(actor, item["id"])
        return {"notebook": item, "activeNotebookId": item["id"]}

    def set_active(self, actor: str, notebook_id: str) -> dict[str, str]:
        if not notebook_id or len(notebook_id) > 200:
            raise UserError("Identificador de cuaderno inválido.")
        self.store.set_active(actor, notebook_id)
        return {"activeNotebookId": notebook_id}

    def sources(self, actor: str, notebook_id: str | None = None) -> dict[str, Any]:
        ident = self._notebook_id(actor, notebook_id)
        data = self.cli.json(["source", "list", "-n", ident, "--json"], timeout=120)
        rows = data if isinstance(data, list) else (
            data.get("sources", data.get("items", [])) if isinstance(data, dict) else []
        )
        result = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            sid = row.get("id") or row.get("source_id")
            if sid:
                result.append({"id": str(sid), "title": str(row.get("title") or row.get("name") or sid),
                               "type": str(row.get("type") or row.get("source_type") or "unknown")})
        return {"sources": result}

    def add_url(self, actor: str, url: str, notebook_id: str | None = None) -> dict[str, Any]:
        ident = self._notebook_id(actor, notebook_id)
        url = validate_public_url(url)
        host = (urlparse(url).hostname or "").lower()
        source_type = "youtube" if host in {"youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"} else "url"
        data = self.cli.json(["source", "add", url, "-n", ident, "--type", source_type, "--json"], timeout=600)
        result = self._source_result(data, url)
        self._wait_source(ident, result["id"])
        return {"source": result}

    def add_pdf(self, actor: str, data: bytes, filename: str = "fuente.pdf",
                notebook_id: str | None = None) -> dict[str, Any]:
        ident = self._notebook_id(actor, notebook_id)
        data = validate_pdf_bytes(data)
        safe_name = Path(filename).name
        if not safe_name.lower().endswith(".pdf"):
            safe_name += ".pdf"
        path = None
        try:
            with tempfile.NamedTemporaryFile(prefix="nl-", suffix=".pdf", delete=False) as fh:
                path = fh.name
                os.chmod(path, 0o600)
                fh.write(data)
            result = self.cli.json(["source", "add", path, "-n", ident, "--type", "file",
                                    "--title", safe_name, "--mime-type", "application/pdf", "--json"],
                                   timeout=600)
            source = self._source_result(result, safe_name)
            self._wait_source(ident, source["id"])
            return {"source": source}
        finally:
            if path:
                try:
                    os.unlink(path)
                except OSError:
                    pass

    @staticmethod
    def _source_result(data: Any, fallback: str) -> dict[str, str]:
        sid = _first_value(data, ("id", "source_id"))
        return {"id": str(sid or ""), "title": str(_first_value(data, ("title", "name")) or fallback),
                "type": str(_first_value(data, ("type", "source_type")) or "url")}

    def _wait_source(self, notebook_id: str, source_id: str) -> None:
        if source_id:
            self.cli.json(["source", "wait", source_id, "-n", notebook_id,
                           "--timeout", "600", "--json"], timeout=660)

    def summary(self, actor: str, notebook_id: str | None = None) -> dict[str, str]:
        ident = self._notebook_id(actor, notebook_id)
        data = self.cli.json(["summary", "-n", ident, "--json"], timeout=900)
        return {"text": _as_text(data)}

    def research(self, actor: str, kind: str, notebook_id: str | None = None,
                 question: str | None = None) -> dict[str, Any]:
        ident = self._notebook_id(actor, notebook_id)
        if kind == "podcast":
            with tempfile.TemporaryDirectory(prefix="nl-audio-") as tmp:
                source = Path(tmp) / "native.m4a"
                # The generated JSON normally includes the task/artifact id.
                # Use it for a race-free download. Older CLI responses may
                # omit it; in that case serialize generation+download for
                # this notebook so --latest cannot select another actor's
                # artifact.
                lock = self._artifact_lock(ident)
                with lock:
                    generated = self.cli.json(["generate", "audio", "-n", ident, "--language", "es",
                                               "--wait", "--json"], timeout=1500)
                    artifact_id = _artifact_id(generated)
                    download = ["download", "audio", "-n", ident]
                    if artifact_id:
                        download += ["--artifact", artifact_id]
                        self.cli.run(download + [str(source)], timeout=600)
                    else:
                        # Legacy CLI output has no selector; keeping both
                        # calls under this notebook lock makes --latest safe.
                        self.cli.run(download + ["--latest", str(source)], timeout=600)
                if not source.exists() or source.stat().st_size == 0:
                    raise UserError("NotebookLM no produjo el audio descargable.")
                target = Path(tmp) / "podcast.mp3"
                ffmpeg = shutil.which("ffmpeg")
                if not ffmpeg:
                    try:
                        import imageio_ffmpeg
                        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
                    except Exception as exc:
                        raise UserError("No hay ffmpeg para convertir el audio a MP3.") from exc
                proc = subprocess.run([ffmpeg, "-y", "-i", str(source), "-vn",
                                       "-codec:a", "libmp3lame", "-b:a", "128k", str(target)],
                                      shell=False, capture_output=True, text=True, timeout=600)
                if proc.returncode or not target.exists():
                    raise UserError("No se pudo convertir el audio nativo a MP3.")
                return self._store_result(target, "podcast.mp3", "audio/mpeg")
        if kind == "report":
            with tempfile.TemporaryDirectory(prefix="nl-report-") as tmp:
                # Reports intentionally use the NotebookLM summary endpoint.
                # This avoids an unrelated Studio artifact and is also the
                # stable command promised by the public API.
                summary = self.summary(actor, ident)
                text = summary["text"]
                target = Path(tmp) / "reporte.md"
                target.write_text(text, encoding="utf-8")
                result = self._store_result(target, "reporte.md", "text/markdown")
                result["text"] = text
                return result
        if kind == "voice":
            question = (question or "").strip()
            if not question:
                raise UserError("Escribe una pregunta para la respuesta por voz.")
            answer = self.cli.json(["ask", question, "-n", ident, "--new", "--yes", "--json"], timeout=900)
            text = _as_text(answer)
            with tempfile.TemporaryDirectory(prefix="nl-voice-") as tmp:
                target = Path(tmp) / "respuesta.mp3"
                try:
                    import edge_tts
                    asyncio.run(edge_tts.Communicate(text, VOICE).save(str(target)))
                except Exception as exc:
                    raise UserError("No se pudo sintetizar la voz neural en español.") from exc
                return dict(self._store_result(target, "respuesta.mp3", "audio/mpeg"), text=text)
        raise UserError("Acción de investigación no reconocida.")

    def news_draft(self, actor: str, notebook_id: str | None = None) -> dict[str, str]:
        """Summarize the sources already in one notebook without publishing."""
        ident = self._notebook_id(actor, notebook_id)
        existing_sources = self.sources(actor, ident)["sources"]
        if not existing_sources:
            raise UserError(
                "El cuaderno no tiene fuentes; añade fuentes al cuaderno antes de crear una noticia."
            )
        prompt = (
            "Redacta un resumen de noticias en español basado exclusivamente en las fuentes "
            "ya seleccionadas de este cuaderno. Incluye datos y contexto. Debe caber en "
            f"un único mensaje de Telegram: máximo {MAX_NEWS_TEXT_UTF16} unidades UTF-16 "
            "(los emoji fuera de BMP cuentan como dos). No añadas fuentes ni propongas publicar."
        )
        answer = self.cli.json(
            ["ask", prompt, "-n", ident, "--new", "--yes", "--json"], timeout=900
        )
        text = _as_text(answer).strip()
        if not text:
            raise UserError("NotebookLM no devolvió texto para la vista previa de la noticia.")
        if utf16_code_units(text) > MAX_NEWS_TEXT_UTF16:
            shortening_prompt = (
                "Reescribe el siguiente borrador como un resumen de noticias en español, "
                f"sin perder sus datos y contexto esenciales y con un máximo estricto de "
                f"{MAX_NEWS_TEXT_UTF16} unidades UTF-16 para un único mensaje de Telegram. "
                "Devuelve solo el texto final, sin explicación.\n\nBORRADOR:\n" + text
            )
            shortened = self.cli.json(
                ["ask", shortening_prompt, "-n", ident, "--new", "--yes", "--json"],
                timeout=900,
            )
            text = _as_text(shortened).strip()
        if not text or utf16_code_units(text) > MAX_NEWS_TEXT_UTF16:
            raise UserError(
                "NotebookLM devolvió una noticia que supera 3500 unidades UTF-16; "
                "no se truncó ni publicó. Genera una vista previa nueva."
            )
        draft_id = self.store.create_news_draft(actor, ident, text)
        return {"text": text, "draftId": draft_id, "notebookId": ident}

    def news_publish(self, actor: str, notebook_id: str | None, draft_id: str,
                     confirmed: bool = False) -> dict[str, Any]:
        """Claim an exact persisted preview, then send it once if confirmed."""
        if confirmed is not True:
            raise UserError("La publicación de noticias requiere confirmed:true.")
        ident = self._notebook_id(actor, notebook_id)
        if not isinstance(draft_id, str) or not re.fullmatch(r"[a-f0-9]{32}", draft_id):
            raise UserError("draftId no es válido.")
        if not self.publisher:
            raise UserError("No hay canal de Telegram configurado para publicar noticias.")
        # A read-only preflight may happen before the irreversible claim. The
        # external publication call itself is always after the durable claim.
        preflight = getattr(self.publisher, "preflight", None)
        if callable(preflight):
            preflight()
        draft = self.store.claim_news_draft(draft_id, actor, ident)
        # Do not catch/retry here: after this point a timeout is an uncertain
        # send and this draft must remain claimed across restarts.
        self.publisher(draft["text"], draft_id)
        return {"text": draft["text"], "published": True}

    def news(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        """Reject the removed URL-ingestion flow instead of providing a bypass."""
        raise UserError(
            "La acción news anterior ya no publica. Usa news_draft y después "
            "news_publish con draftId y confirmed:true."
        )

    def _store_result(self, path: Path, file_name: str, mime_type: str) -> dict[str, Any]:
        if path.stat().st_size > MAX_TELEGRAM_FILE_BYTES:
            raise UserError("El resultado supera el límite seguro de archivo (45 MB).")
        permanent = Path(tempfile.gettempdir()) / f"notebooklm-{secrets.token_hex(16)}-{Path(file_name).name}"
        shutil.copyfile(path, permanent)
        os.chmod(permanent, 0o600)
        file_id = self.store.add_file(str(permanent), mime_type, file_name)
        return {"downloadUrl": f"/api/notebooklm/files/{file_id}", "fileName": file_name,
                "mimeType": mime_type}

    def node_health(self) -> dict[str, Any]:
        endpoint = os.environ.get("HUB_ENDPOINT_URL", "")
        if not endpoint:
            return {"online": False, "status": "not_configured",
                    "message": "HUB_ENDPOINT_URL no está configurada."}
        try:
            endpoint = validate_https_url(endpoint)
            request = Request(endpoint, method="GET")
            # Redirects are disabled. The token is never put in a URL or output.
            opener = build_opener(_NoRedirect())
            headers = {}
            token = os.environ.get("CONEXION_NOTEBOOK_PUENTE") or os.environ.get("SGN_SECRET_TOKEN")
            if token:
                headers["X-SGN-Token"] = token
            request.headers.update(headers)
            with opener.open(request, timeout=8) as response:
                status = int(response.status)
                response.read(1024)
            return {"online": 200 <= status < 300, "status": str(status),
                    "message": "Hub accesible." if 200 <= status < 300 else "Hub respondió con error.",
                    "url": endpoint}
        except HTTPError as exc:
            return {"online": False, "status": str(exc.code), "message": "Hub rechazó la comprobación.", "url": endpoint}
        except Exception:
            return {"online": False, "status": "offline", "message": "No se pudo comprobar el hub.", "url": endpoint}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class JobManager:
    def __init__(self, service: NotebookService, max_workers: int = MAX_WORKERS,
                 max_queue: int = MAX_JOB_QUEUE,
                 notifier: Callable[[str, str, str, str | None, dict[str, Any] | None], Any] | None = None):
        self.service = service
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        self.slots = threading.BoundedSemaphore(max_workers + max_queue)
        self.notifier = notifier

    def enqueue(self, actor: str, action: str, payload: dict[str, Any]) -> str:
        if action == "news_publish" and payload.get("confirmed") is not True:
            raise UserError("La publicación de noticias requiere confirmed:true.")
        if not self.slots.acquire(blocking=False):
            raise UserError("La cola está llena; inténtalo de nuevo más tarde.")
        # Snapshot the active notebook now, not when a worker eventually gets
        # CPU time.  This prevents a later selection change from retargeting a
        # queued source/news/research operation.
        frozen_payload = dict(payload)
        frozen_payload["notebookId"] = (
            frozen_payload.get("notebookId") or self.service.store.active(actor)
        )
        job_id = self.service.store.create_job(actor, action)
        self.executor.submit(self._run, job_id, actor, action, frozen_payload)
        return job_id

    def _run(self, job_id: str, actor: str, action: str, payload: dict[str, Any]) -> None:
        self.service.store.update_job(job_id, "running")
        try:
            notebook_id = payload.get("notebookId")
            if notebook_id:
                self.service.set_active(actor, notebook_id)
            if action == "source_url":
                result = self.service.add_url(actor, payload.get("url", ""), notebook_id)
            elif action == "source_pdf":
                raw = base64.b64decode(payload.get("pdfBase64", ""), validate=True)
                result = self.service.add_pdf(actor, raw, payload.get("filename", "fuente.pdf"), notebook_id)
            elif action in {"podcast", "report", "voice"}:
                result = self.service.research(actor, action, notebook_id, payload.get("question"))
            elif action == "news_draft":
                result = self.service.news_draft(actor, notebook_id)
            elif action == "news_publish":
                result = self.service.news_publish(
                    actor, notebook_id, payload.get("draftId", ""),
                    payload.get("confirmed") is True,
                )
            else:
                raise UserError("Acción desconocida.")
            self.service.store.update_job(job_id, "completed", result=result)
            self._deliver(job_id, actor, action, "completed", None, result)
        except UserError as exc:
            message = str(exc)[:500] or "La tarea falló."
            self.service.store.update_job(job_id, "failed", message=message)
            self._deliver(job_id, actor, action, "failed", message, None)
        except Exception:
            # Never reflect arbitrary exception text: subprocess/network
            # libraries can include credentials or profile paths.
            message = "La tarea falló por un error interno; inténtalo de nuevo."
            self.service.store.update_job(job_id, "failed", message=message)
            self._deliver(job_id, actor, action, "failed", message, None)
        finally:
            self.slots.release()

    def _deliver(self, job_id: str, actor: str, action: str, status: str,
                 message: str | None, result: dict[str, Any] | None) -> None:
        if not self.notifier or not self.service.store.claim_delivery(job_id):
            return
        try:
            self.notifier(actor, action, status, message, result)
        except Exception:
            # Delivery failures are visible in GET job status and are never
            # retried automatically (which could duplicate an external send).
            self.service.store.finish_delivery(
                job_id, "failed", "No se pudo notificar el resultado; no se reintentará automáticamente."
            )
        else:
            self.service.store.finish_delivery(job_id, "delivered")


def _auth_required(service: NotebookService):
    from flask import request, jsonify
    token = os.environ.get("CONEXION_NOTEBOOK_PUENTE") or os.environ.get("SGN_SECRET_TOKEN", "")
    supplied = request.headers.get("X-SGN-Token", "")
    if not token or not supplied or not timing_safe_equal(supplied, token):
        return jsonify({"error": "No autorizado."}), 401
    return None


def create_app(service: NotebookService | None = None, manager: JobManager | None = None):
    """Create the Flask app without starting a server or a Telegram bot."""
    from flask import Flask, jsonify, request, send_file
    service = service or NotebookService()
    manager = manager or JobManager(service)
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

    @app.before_request
    def protect():
        return _auth_required(service)

    @app.errorhandler(UserError)
    def user_error(exc):
        return jsonify({"error": str(exc)}), 400

    @app.errorhandler(413)
    def too_large(_):
        return jsonify({"error": "La petición supera el límite de 8 MB; los PDF tienen límite de 4 MB."}), 413

    @app.get("/api/notebooklm/status")
    def api_status():
        return jsonify(service.status())

    @app.get("/api/notebooklm/notebooks")
    def api_notebooks():
        return jsonify(service.notebooks(_actor()))

    @app.post("/api/notebooklm/notebooks")
    def api_create():
        data = request.get_json(silent=True) or {}
        return jsonify(service.create_notebook(_actor(), data.get("title", "")))

    @app.put("/api/notebooklm/active")
    def api_active():
        data = request.get_json(silent=True) or {}
        return jsonify(service.set_active(_actor(), data.get("notebookId", "")))

    @app.get("/api/notebooklm/sources")
    def api_sources():
        return jsonify(service.sources(_actor(), request.args.get("notebookId")))

    @app.get("/api/notebooklm/nodes")
    def api_nodes():
        return jsonify(service.node_health())

    @app.post("/api/notebooklm/jobs")
    def api_job():
        data = request.get_json(silent=True) or {}
        action = data.get("action")
        valid = {
            "source_url", "source_pdf", "podcast", "report", "voice",
            "news_draft", "news_publish",
        }
        if action not in valid:
            if action == "news":
                return jsonify({
                    "error": (
                        "La acción news anterior no publica. Usa news_draft y después "
                        "news_publish con draftId y confirmed:true."
                    )
                }), 400
            return jsonify({
                "error": (
                    "action debe ser source_url, source_pdf, podcast, report, voice, "
                    "news_draft o news_publish."
                )
            }), 400
        if action == "news_draft":
            if not data.get("notebookId"):
                return jsonify({"error": "news_draft requiere notebookId."}), 400
            if "text" in data or "destination" in data:
                return jsonify({
                    "error": "news_draft genera el texto desde las fuentes del cuaderno; no acepta texto ni destino."
                }), 400
        if action == "news_publish":
            if not data.get("notebookId") or not data.get("draftId"):
                return jsonify({"error": "news_publish requiere notebookId y draftId."}), 400
            if data.get("confirmed") is not True:
                return jsonify({"error": "La publicación de noticias requiere confirmed:true."}), 400
            if "text" in data or "destination" in data:
                return jsonify({
                    "error": "news_publish usa únicamente el texto y destino fijados en el borrador."
                }), 400
        if action == "source_url":
            try:
                validate_public_url(data.get("url", ""))
            except UserError as exc:
                return jsonify({"error": str(exc)}), 400
        if action == "source_pdf":
            try:
                raw = base64.b64decode(data.get("pdfBase64", ""), validate=True)
                validate_pdf_bytes(raw)
            except (binascii.Error, UserError):
                return jsonify({"error": "pdfBase64 debe contener un PDF válido de hasta 4 MB."}), 400
        try:
            job_id = manager.enqueue(_actor(), action, data)
        except UserError as exc:
            return jsonify({"error": str(exc)}), 429
        return jsonify({"id": job_id, "status": "queued"}), 202

    @app.get("/api/notebooklm/jobs/<job_id>")
    def api_job_status(job_id):
        job = service.store.job(job_id)
        if not job or job["actor"] != _actor():
            return jsonify({"error": "Trabajo no encontrado."}), 404
        return jsonify(job)

    @app.get("/api/notebooklm/files/<file_id>")
    def api_file(file_id):
        row = service.store.file(file_id)
        if not row or not service.store.owns_file(_actor(), file_id) or not Path(row["path"]).is_file():
            return jsonify({"error": "Archivo no encontrado o caducado."}), 404
        return send_file(row["path"], mimetype=row["mime_type"], as_attachment=True,
                         download_name=row["file_name"], max_age=0)

    def _actor() -> str:
        actor = request.headers.get("X-SGN-Actor", "ide").strip()
        # The token authenticates the request; actor is only a namespaced store
        # key and is never treated as a Telegram identity.
        return actor[:120] or "ide"

    return app


def _allowed_ids() -> set[int]:
    return {int(x.strip()) for x in os.environ.get("TELEGRAM_ALLOWED_USER_IDS", "").split(",")
            if x.strip().lstrip("-").isdigit()}


def build_bot(service: NotebookService, manager: JobManager | None = None):
    """Build handlers; importing this function does not start polling."""
    try:
        import telebot
        from telebot import types
    except ImportError as exc:
        raise UserError("Instala pyTelegramBotAPI antes de iniciar el bot.") from exc
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "")
    if not token:
        raise UserError("Falta TELEGRAM_BOT_TOKEN.")
    # All generated titles, answers and source text are untrusted. Plain text
    # avoids Telegram HTML/Markdown injection without requiring escaping at
    # every call site.
    bot = telebot.TeleBot(token)
    if channel:
        # Kept as a callback on the shared service so API and Telegram jobs
        # apply the same confirmation and summarisation logic.
        service.publisher = lambda text, _draft_id: bot.send_message(channel, text)
    manager = manager or JobManager(service)
    pending: dict[int, dict[str, Any]] = {}
    callbacks: dict[str, tuple[int, str]] = {}
    pending_lock = threading.RLock()

    def authorized(message, actor=None) -> bool:
        if getattr(message.chat, "type", "") != "private":
            return False
        # CallbackQuery.message is authored by this bot. Use the callback
        # sender, never message.from_user, for authorization.
        subject = actor or getattr(message, "from_user", None)
        if subject is None:
            return False
        uid = int(subject.id)
        if uid in _allowed_ids():
            return True
        if not channel:
            return False
        try:
            member = bot.get_chat_member(channel, uid)
            return member.status in {"administrator", "creator"}
        except Exception:
            return False

    def explain_send(chat_id: int, text: str):
        bot.send_message(chat_id, text, reply_markup=panel_markup())

    def panel_markup():
        mark = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
        mark.add(types.KeyboardButton("➕ Añadir Fuente"), types.KeyboardButton("🚀 Iniciar Investigación"))
        mark.add(types.KeyboardButton("📊 Ver Fuentes"), types.KeyboardButton("📂 Cuadernos"))
        mark.add(types.KeyboardButton("📰 Publicar noticia"), types.KeyboardButton("🗣 Preguntar por voz"))
        mark.add(types.KeyboardButton("🌐 Estado de nodos"), types.KeyboardButton("❓ Ayuda"))
        return mark

    def cancel_markup():
        mark = types.ReplyKeyboardMarkup(resize_keyboard=True, row_width=2)
        mark.add(types.KeyboardButton("Cancelar"), types.KeyboardButton("⬅ Volver"))
        return mark

    def send_chunks(chat_id: int, text: str, prefix: str = ""):
        text = str(text or "")
        if prefix:
            text = prefix + text
        if not text:
            return
        for offset in range(0, len(text), 3900):
            bot.send_message(chat_id, text[offset:offset + 3900])

    def notify_job(actor, action, status, message, result):
        """Deliver a completed result once to its originating private chat."""
        # HTTP owners such as "ide" have no Telegram chat to notify. Their
        # result remains available through the API and must not be marked as a
        # failed delivery merely because this process also has a bot.
        try:
            chat_id = int(actor)
        except (TypeError, ValueError):
            return
        if status == "failed":
            send_chunks(chat_id, message or "La tarea falló.", "NotebookLM: ")
            return
        result = result or {}
        if action in {"source_url", "source_pdf"}:
            source = result.get("source", {})
            bot.send_message(chat_id, f"Fuente indexada: {source.get('title', 'fuente')}.",
                             reply_markup=panel_markup())
            return
        download_url = result.get("downloadUrl", "")
        file_id = download_url.rsplit("/", 1)[-1] if "/files/" in download_url else ""
        row = service.store.file(file_id) if file_id else None
        if row and Path(row["path"]).is_file():
            if Path(row["path"]).stat().st_size > MAX_TELEGRAM_FILE_BYTES:
                raise UserError("El resultado supera el límite de archivo de Telegram; no se envió.")
            if action == "podcast":
                with open(row["path"], "rb") as audio:
                    bot.send_audio(chat_id, audio, caption="Podcast listo (MP3).")
            elif action == "voice":
                send_chunks(chat_id, result.get("text", ""), "Respuesta:\n")
                with open(row["path"], "rb") as audio:
                    bot.send_voice(chat_id, audio)
            elif action == "report":
                send_chunks(chat_id, result.get("text", ""), "Reporte:\n")
                with open(row["path"], "rb") as document:
                    bot.send_document(chat_id, document, caption="Reporte descargable (UTF-8).")
            return
        send_chunks(chat_id, result.get("text", ""), "Resultado listo:\n")

    manager.notifier = notify_job

    def action_text(action: str) -> str:
        return {
            "source_url": "Añade una URL web o YouTube al cuaderno activo. Escribe la URL; recibirás confirmación cuando quede indexada.",
            "source_pdf": "Añade un PDF de hasta 4 MB al cuaderno activo. Envía ahora el documento; se eliminará la copia temporal al terminar.",
            "podcast": "Genera un podcast en español con tus fuentes. Tardará unos minutos y recibirás un MP3.",
            "report": "Genera un reporte Markdown basado en el cuaderno activo. Recibirás un archivo descargable.",
            "voice": "Pregunta al cuaderno y recibe la respuesta con voz neural. Escribe ahora tu pregunta.",
        }[action]

    @bot.message_handler(commands=["start", "panel"])
    def start(message):
        if authorized(message):
            explain_send(message.chat.id, "Panel NotebookLM: elige cuaderno → añade fuentes → genera podcast, reporte o respuesta.")

    @bot.message_handler(
        func=lambda m: bool(getattr(m, "text", "")) and not m.text.startswith("/"),
        content_types=["text"],
    )
    def messages(message):
        if not authorized(message):
            return
        chat_id = int(message.chat.id)
        text = (message.text or "").strip()
        if text in {"Cancelar", "⬅ Volver"}:
            with pending_lock:
                pending.pop(chat_id, None)
            explain_send(chat_id, "Operación cancelada. Elige una acción en el panel.")
            return
        if text == "❓ Ayuda":
            explain_send(chat_id, "Elige un cuaderno, añade una URL/PDF y luego inicia una investigación. Cada botón explica qué entrada necesita y qué resultado entrega.")
            return
        if text == "➕ Añadir Fuente":
            with pending_lock:
                pending[chat_id] = {"kind": "source_choice"}
            mark = types.InlineKeyboardMarkup()
            mark.add(types.InlineKeyboardButton("🌐 URL web/YouTube", callback_data="nl:srcurl"))
            mark.add(types.InlineKeyboardButton("📄 PDF", callback_data="nl:srcpdf"))
            bot.send_message(chat_id, "Añadir Fuente: elige URL o PDF. Resultado: la fuente se acumula en el cuaderno activo.", reply_markup=cancel_markup())
            bot.send_message(chat_id, "Tipo de fuente:", reply_markup=mark)
            return
        if text == "🚀 Iniciar Investigación":
            mark = types.InlineKeyboardMarkup()
            mark.add(types.InlineKeyboardButton("🎙 Podcast", callback_data="nl:podcast"),
                     types.InlineKeyboardButton("📑 Reporte", callback_data="nl:report"))
            bot.send_message(chat_id, "Investigación: genera un audio o reporte con las fuentes del cuaderno activo. Elige el formato.", reply_markup=mark)
            return
        if text == "📊 Ver Fuentes":
            try:
                data = service.sources(str(chat_id))
                lines = [f"• {s['title']} ({s['type']})" for s in data["sources"]]
                bot.send_message(chat_id, "Fuentes del cuaderno activo:\n" + ("\n".join(lines) if lines else "Aún no hay fuentes."))
            except Exception as exc:
                bot.send_message(chat_id, str(exc))
            return
        if text == "📂 Cuadernos":
            show_notebooks(chat_id)
            return
        if text == "➕ Crear cuaderno":
            with pending_lock:
                pending[chat_id] = {"kind": "create"}
            bot.send_message(chat_id, "Crear cuaderno: escribe un título. Resultado: se crea y queda seleccionado.", reply_markup=cancel_markup())
            return
        if text == "📰 Publicar noticia":
            bot.send_message(
                chat_id,
                "La publicación de noticias del bot independiente está desactivada: "
                "usa la vista previa news_draft y la confirmación news_publish de la API.",
                reply_markup=panel_markup(),
            )
            return
        if text == "🗣 Preguntar por voz":
            with pending_lock:
                pending[chat_id] = {"kind": "voice"}
            bot.send_message(chat_id, action_text("voice"), reply_markup=cancel_markup())
            return
        if text == "🌐 Estado de nodos":
            health = service.node_health()
            bot.send_message(chat_id, f"Estado de nodos: {health['message']} ({health['status']}).")
            return
        with pending_lock:
            state = pending.get(chat_id)
        if not state:
            bot.send_message(chat_id, "Usa los botones del panel para empezar.", reply_markup=panel_markup())
            return
        try:
            kind = state["kind"]
            if kind == "source_url":
                result = service.add_url(str(chat_id), text)
                bot.send_message(chat_id, f"Fuente indexada: {result['source']['title']}.", reply_markup=panel_markup())
            elif kind == "create":
                result = service.create_notebook(str(chat_id), text)
                bot.send_message(chat_id, f"Cuaderno creado y seleccionado: {result['notebook']['title']}.", reply_markup=panel_markup())
            elif kind == "voice":
                job = manager.enqueue(str(chat_id), "voice", {"question": text})
                bot.send_message(chat_id, f"Pregunta en cola ({job[:8]}). Te enviaré el MP3 al terminar.")
            with pending_lock:
                pending.pop(chat_id, None)
        except Exception as exc:
            bot.send_message(chat_id, str(exc))

    @bot.message_handler(content_types=["document"])
    def document(message):
        if not authorized(message):
            return
        chat_id = int(message.chat.id)
        with pending_lock:
            state = pending.get(chat_id)
        if not state or state.get("kind") != "source_pdf":
            bot.send_message(chat_id, "Pulsa ➕ Añadir Fuente y elige PDF antes de enviarlo.")
            return
        try:
            info = bot.get_file(message.document.file_id)
            data = bot.download_file(info.file_path)
            result = service.add_pdf(str(chat_id), data, message.document.file_name)
            bot.send_message(chat_id, f"PDF indexado: {result['source']['title']}.", reply_markup=panel_markup())
            with pending_lock:
                pending.pop(chat_id, None)
        except Exception as exc:
            bot.send_message(chat_id, str(exc))

    def show_notebooks(chat_id: int):
        try:
            data = service.notebooks(str(chat_id))
            mark = types.InlineKeyboardMarkup()
            for notebook in data["notebooks"][:30]:
                key = "nl:u:" + secrets.token_urlsafe(12)
                callbacks[key] = (chat_id, notebook["id"])
                mark.add(types.InlineKeyboardButton(("✅ " if notebook["id"] == data["activeNotebookId"] else "") + notebook["title"][:40],
                                                     callback_data=key))
            mark.add(types.InlineKeyboardButton("➕ Crear cuaderno", callback_data="nl:create"))
            bot.send_message(chat_id, "Cuadernos: selecciona uno para hacerlo activo o crea otro.", reply_markup=mark)
        except Exception as exc:
            bot.send_message(chat_id, str(exc))

    @bot.callback_query_handler(func=lambda call: True)
    def callback(call):
        # Telegram's callback message is authored by this bot; authenticate
        # the human who pressed the button via CallbackQuery.from_user.
        if not getattr(call, "from_user", None) or not authorized(call.message, call.from_user):
            return
        chat_id = int(call.message.chat.id)
        data = call.data or ""
        try:
            if data in callbacks:
                owner, notebook_id = callbacks.pop(data)
                if owner != chat_id:
                    return
                service.set_active(str(chat_id), notebook_id)
                bot.answer_callback_query(call.id, "Cuaderno activo.")
                bot.send_message(chat_id, "Cuaderno seleccionado. Añade fuentes o inicia una investigación.", reply_markup=panel_markup())
            elif data == "nl:srcurl":
                pending[chat_id] = {"kind": "source_url"}
                bot.answer_callback_query(call.id)
                bot.send_message(chat_id, action_text("source_url"), reply_markup=cancel_markup())
            elif data == "nl:srcpdf":
                pending[chat_id] = {"kind": "source_pdf"}
                bot.answer_callback_query(call.id)
                bot.send_message(chat_id, action_text("source_pdf"), reply_markup=cancel_markup())
            elif data in {"nl:podcast", "nl:report"}:
                kind = data.split(":")[1]
                bot.answer_callback_query(call.id, "Trabajo iniciado.")
                job = manager.enqueue(str(chat_id), kind, {})
                bot.send_message(chat_id, f"{action_text(kind)}\nTrabajo en cola: {job[:8]}.", reply_markup=panel_markup())
            elif data == "nl:create":
                pending[chat_id] = {"kind": "create"}
                bot.answer_callback_query(call.id)
                bot.send_message(chat_id, "Crear cuaderno: escribe un título.", reply_markup=cancel_markup())
            elif data == "nl:newsok":
                pending.pop(chat_id, None)
                raise UserError(
                    "La publicación por URL ya no está disponible. Usa news_draft y "
                    "news_publish con draftId y confirmed:true en la API."
                )
            elif data == "nl:cancel":
                pending.pop(chat_id, None)
                bot.answer_callback_query(call.id, "Cancelado.")
                bot.send_message(chat_id, "Operación cancelada.", reply_markup=panel_markup())
        except Exception as exc:
            bot.answer_callback_query(call.id, "Error")
            bot.send_message(chat_id, str(exc))

    # Compatibility commands remain optional; buttons are the primary UX.
    @bot.message_handler(commands=["noticia", "voz"])
    def compatibility(message):
        if not authorized(message):
            return
        command, _, rest = (message.text or "").partition(" ")
        if command == "/noticia":
            bot.send_message(
                message.chat.id,
                "/noticia no acepta URLs ni publica directamente. Usa news_draft y "
                "news_publish con confirmación explícita en la API.",
            )
        else:
            pending[int(message.chat.id)] = {"kind": "voice"}
            if rest.strip():
                try:
                    job = manager.enqueue(str(message.chat.id), "voice", {"question": rest.strip()})
                    bot.send_message(message.chat.id, f"Pregunta en cola: {job[:8]}.")
                except Exception as exc:
                    bot.send_message(message.chat.id, str(exc))
            else:
                bot.send_message(message.chat.id, action_text("voice"), reply_markup=cancel_markup())

    return bot


def run(args: argparse.Namespace) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    secret = os.environ.get("CONEXION_NOTEBOOK_PUENTE") or os.environ.get("SGN_SECRET_TOKEN", "")
    channel = os.environ.get("TELEGRAM_CHANNEL_ID", "")
    if not secret:
        raise SystemExit("Falta CONEXION_NOTEBOOK_PUENTE: la API nunca se inicia sin autenticación.")
    try:
        validate_https_url(os.environ.get("HUB_ENDPOINT_URL", ""))
    except UserError as exc:
        raise SystemExit(str(exc)) from exc
    service = NotebookService()
    manager = JobManager(service)
    app = create_app(service, manager)
    if args.api_only:
        # API-only mode deliberately does not construct a Telegram bot. This
        # keeps TELEGRAM_* optional and makes it impossible to start polling.
        # A configured Railway callback owns the Telegram token and validates
        # its fixed destination; this process never receives that token.
        publisher_url = os.environ.get("NOTEBOOKLM_PUBLISHER_URL", "")
        if publisher_url:
            service.publisher = RemoteNotebookPublisher(
                publisher_url,
                os.environ.get("CONEXION_NOTEBOOK_PUENTE")
                or os.environ.get("SGN_SECRET_TOKEN", ""),
            )
        app.run(host=args.host, port=args.port, threaded=True)
        return
    if not channel:
        raise SystemExit("Falta TELEGRAM_CHANNEL_ID.")
    if not token:
        raise SystemExit("Falta TELEGRAM_BOT_TOKEN (usa --api-only para ejecutar solo la API).")
    bot = build_bot(service, manager)
    # Never delete another deployment's webhook. Polling is refused explicitly
    # until an operator resolves an active webhook.
    webhook = bot.get_webhook_info()
    if getattr(webhook, "url", ""):
        raise SystemExit("Hay un webhook activo; se rechaza polling sin borrarlo automáticamente.")
    import threading as _threading
    _threading.Thread(target=lambda: bot.infinity_polling(allowed_updates=["message", "callback_query"]),
                      daemon=True).start()
    app.run(host=args.host, port=args.port, threaded=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="NotebookLM Telegram bot + API")
    parser.add_argument("--api-only", action="store_true", help="Ejecutar solo la API Flask.")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    run(parser.parse_args())


if __name__ == "__main__":
    main()