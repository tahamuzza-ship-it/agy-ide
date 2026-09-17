"""Read-only live transport checks. Credentials are used only as HTTPS headers."""
import argparse
import hashlib
import json
import os
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.error import HTTPError

AGY = "https://agy-ide-production.up.railway.app"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError("Redirect refused")


def get(url, headers):
    with build_opener(NoRedirect).open(Request(url, headers=headers), timeout=65) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    ide_headers = {"x-agyide-pwd": quote(os.environ["AGY_IDE_PASSWORD"], safe="")}
    books = get(AGY + "/api/notebooklm/notebooks", ide_headers)
    notebook_ids = sorted(str(book["id"]) for book in books.get("notebooks", []))
    result = {
        "agy_notebook_count": len(notebook_ids),
        "notebook_ids_sha256": hashlib.sha256(json.dumps(notebook_ids).encode()).hexdigest(),
    }
    if not args.baseline:
        headers = {"X-SGN-Token": os.environ["CONEXION_NOTEBOOK_PUENTE"]}
        registry = get(AGY + "/api/notebooklm/endpoint", headers)
        result.update(registry_ok=registry.get("ok"),
                      generation=registry.get("generation"),
                      transport_version=registry.get("transportVersion"))
        endpoint = registry["endpoint"]
        if not endpoint.startswith("https://") or not endpoint.endswith(".trycloudflare.com"):
            raise RuntimeError("Unexpected transport origin")
        # This is a read-only call using the Telegram adapter's actor namespace.
        # No Telegram update is injected, and no existing chat state is changed.
        headers["X-SGN-Actor"] = "codearquitect:transport-check"
        bot_books = get(endpoint + "/api/notebooklm/notebooks", headers)
        result["codearquitect_transport_notebook_count"] = len(bot_books.get("notebooks", []))
        result["same_notebooks"] = sorted(str(b["id"]) for b in bot_books.get("notebooks", [])) == notebook_ids
        status = get(AGY + "/api/notebooklm/status", ide_headers)
        result["configured"] = status.get("configured")
        result["google_authenticated"] = status.get("authenticated")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error_type": type(error).__name__,
                          "http_status": error.code if isinstance(error, HTTPError) else None}))
        raise SystemExit(1)