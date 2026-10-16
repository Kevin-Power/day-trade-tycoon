"""market-data on disk: raw evidence, atomic day publishing, status, logs, retention and the run lock."""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Callable

DAY_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HISTORY_LIMIT = 30


class Locked(Exception):
    """Another fetch still holds the run lock."""


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _json_bytes(value: object, indent: int | None = None) -> bytes:
    separators = None if indent else (",", ":")
    return json.dumps(value, ensure_ascii=False, sort_keys=indent is None, indent=indent,
                      separators=separators).encode("utf-8")


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


class MarketStore:
    def __init__(self, root: Path, pid_alive: Callable[[int], bool] = process_alive):
        self.root = Path(root)
        self._pid_alive = pid_alive
        self._redact: Callable[[object], str] = str

    # Secrets never reach the disk: status and logs pass through the redactor.
    def set_redactor(self, redact: Callable[[object], str]) -> None:
        self._redact = redact

    def redact(self, text: object) -> str:
        return self._redact(text)

    def has_day(self, day: str) -> bool:
        return (self.root / "days" / day / "manifest.json").is_file()

    def _raw_path(self, day: str, kind: str, name: str | None) -> Path:
        base = self.root / "staging" / day / "raw"
        return base / f"{kind}.json.gz" if name is None else base / kind / f"{name}.json.gz"

    def save_raw(self, day: str, kind: str, name: str | None, payload: object) -> None:
        _write_atomic(self._raw_path(day, kind, name), gzip.compress(_json_bytes(payload), mtime=0))

    def load_raw(self, day: str, kind: str, name: str | None = None) -> object | None:
        path = self._raw_path(day, kind, name)
        if not path.is_file():
            return None
        return json.loads(gzip.decompress(path.read_bytes()))

    def discard_staging(self, day: str) -> None:
        shutil.rmtree(self.root / "staging" / day, ignore_errors=True)

    def publish_day(self, day: str, coverage: str, entries: list[dict], bars: dict[str, list],
                    warnings: list[dict], excluded: int, published_at: datetime, source: str,
                    version: str) -> dict:
        target = self.root / "days" / day
        if target.exists():
            raise FileExistsError(day)
        staging = self.root / "staging" / day / "day"
        shutil.rmtree(staging, ignore_errors=True)
        (staging / "symbols").mkdir(parents=True)
        files = []

        def put(relative: str, data: bytes) -> None:
            (staging / relative).write_bytes(data)
            files.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

        stamp = published_at.isoformat(timespec="seconds")
        put("index.json", _json_bytes({"schema": 1, "date": day, "coverage": coverage, "volumeUnit": "lot",
                                       "source": source, "fetchedAt": stamp, "symbols": entries}, indent=1))
        for code in sorted(bars):
            payload = {"schema": 1, "code": code, "date": day, "volumeUnit": "lot", "bars": bars[code]}
            put(f"symbols/{code}.json.gz", gzip.compress(_json_bytes(payload), mtime=0))
        manifest = {"schema": 1, "date": day, "coverage": coverage, "createdAt": stamp, "version": version,
                    "counts": {"symbols": len(entries), "bars": sum(len(rows) for rows in bars.values()),
                               "excluded": excluded},
                    "warnings": warnings, "files": files}
        manifest_bytes = _json_bytes(manifest, indent=1)
        (staging / "manifest.json").write_bytes(manifest_bytes)
        target.parent.mkdir(parents=True, exist_ok=True)
        os.replace(staging, target)
        raw = self.root / "staging" / day / "raw"
        if raw.exists():
            (self.root / "raw").mkdir(parents=True, exist_ok=True)
            os.replace(raw, self.root / "raw" / day)
        self.discard_staging(day)
        self._update_index({"date": day, "coverage": coverage, "symbols": len(entries),
                            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "publishedAt": stamp})
        return manifest

    def _read_json(self, name: str, default: dict) -> dict:
        path = self.root / name
        if not path.is_file():
            return default
        return json.loads(path.read_text(encoding="utf-8-sig"))

    def _update_index(self, entry: dict) -> None:
        index = self._read_json("index.json", {"schema": 1, "days": []})
        days = [day for day in index["days"] if day["date"] != entry["date"]] + [entry]
        index["days"] = sorted(days, key=lambda day: day["date"])
        _write_atomic(self.root / "index.json", _json_bytes(index, indent=1))

    def read_status(self) -> dict:
        return self._read_json("status.json", {"schema": 1, "latestDay": None, "lastRun": None, "history": []})

    def write_run(self, run: dict) -> None:
        status = self.read_status()
        status["lastRun"] = run
        if run["outcome"] != "running":
            status["history"] = (status["history"] + [{"date": run["date"], "outcome": run["outcome"],
                                                       "finishedAt": run["finishedAt"]}])[-HISTORY_LIMIT:]
        days = self._read_json("index.json", {"schema": 1, "days": []})["days"]
        status["latestDay"] = days[-1]["date"] if days else None
        text = self.redact(json.dumps(status, ensure_ascii=False, indent=1))
        _write_atomic(self.root / "status.json", text.encode("utf-8"))

    def log(self, day: str, message: str, at: datetime) -> None:
        path = self.root / "logs" / f"{day}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{at:%Y-%m-%d %H:%M:%S} {self.redact(message)}\n")

    def prune(self, today: date, raw_days: int = 365, log_days: int = 90) -> None:
        def age(name: str) -> int | None:
            return (today - date.fromisoformat(name)).days if DAY_NAME.match(name) else None

        raw = self.root / "raw"
        if raw.is_dir():
            for entry in raw.iterdir():
                days_old = age(entry.name)
                if entry.is_dir() and days_old is not None and days_old > raw_days:
                    shutil.rmtree(entry)
        logs = self.root / "logs"
        if logs.is_dir():
            for entry in logs.glob("*.log"):
                days_old = age(entry.stem)
                if days_old is not None and days_old > log_days:
                    entry.unlink()

    @contextlib.contextmanager
    def lock(self, now: datetime):
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / ".lock"
        for attempt in range(2):
            try:
                handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                break
            except FileExistsError:
                try:
                    pid = int(json.loads(path.read_text(encoding="utf-8")).get("pid", 0))
                except (OSError, ValueError, AttributeError):
                    pid = 0
                if attempt == 1 or self._pid_alive(pid):
                    raise Locked() from None
                path.unlink(missing_ok=True)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump({"pid": os.getpid(), "startedAt": now.isoformat(timespec="seconds")}, stream)
        try:
            yield
        finally:
            path.unlink(missing_ok=True)
