"""market-data on disk: raw evidence, atomic day publishing, status, logs, retention and the run lock."""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import json
import os
import re
import shutil
import time
import uuid
import zlib
from datetime import date, datetime
from pathlib import Path
from typing import Callable

DAY_NAME = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HISTORY_LIMIT = 30
# Longer than the scheduled task's two-hour limit: an older lock belongs to a run that is gone.
STALE_LOCK_SECONDS = 2.5 * 3600
REPLACE_ATTEMPTS = 5
# A stored answer that reads but cannot be decoded; any other OSError (a file held by a scanner, say) may pass.
UNDECODABLE = (EOFError, ValueError, gzip.BadGzipFile, zlib.error)


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


def _replace(source: Path, target: Path) -> None:
    """os.replace, retried briefly: Windows refuses a move while a scanner still holds a file."""
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(source, target)
            return
        except PermissionError:
            if attempt == REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(0.5 * (attempt + 1))


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_bytes(data)
    _replace(temporary, path)


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

    def drop_raw(self, day: str, kind: str, name: str | None = None) -> None:
        self._raw_path(day, kind, name).unlink(missing_ok=True)

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
        _replace(staging, target)
        raw = self.root / "staging" / day / "raw"
        if raw.exists():
            (self.root / "raw").mkdir(parents=True, exist_ok=True)
            _replace(raw, self.root / "raw" / day)
        self.discard_staging(day)
        self._update_index({"date": day, "coverage": coverage, "symbols": len(entries),
                            "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "publishedAt": stamp})
        return manifest

    # Trade-by-trade data lives in its own tree (ticks/<day>), apart from the minute candles: Fubon serves
    # trades only on the day itself, so they are kept for good (prune never touches them).
    def has_ticks(self, day: str) -> bool:
        return (self.root / "ticks" / day / "manifest.json").is_file()

    def _tick_raw_path(self, day: str, code: str) -> Path:
        return self.root / "staging-ticks" / day / "raw" / f"{code}.json.gz"

    def _tick_meta_path(self, day: str, code: str) -> Path:
        return self.root / "staging-ticks" / day / "meta" / f"{code}.json"

    def save_tick_raw(self, day: str, code: str, pages: list, meta: dict) -> None:
        """Fubon's answer as received, with the snapshot facts (name, volume, close) needed to check it later."""
        _write_atomic(self._tick_meta_path(day, code), _json_bytes(meta))
        _write_atomic(self._tick_raw_path(day, code), gzip.compress(_json_bytes(pages), mtime=0))

    def load_tick_raw(self, day: str, code: str) -> tuple[list, dict] | None:
        """The cached answer and its facts. One that cannot be decoded is moved among the stock's fallbacks, which
        go along as evidence, and fetched again; a file that cannot be read just now raises and stays."""
        raw, meta = self._tick_raw_path(day, code), self._tick_meta_path(day, code)
        if not (raw.is_file() and meta.is_file()):
            return None
        data, facts = raw.read_bytes(), meta.read_bytes()
        try:
            return json.loads(gzip.decompress(data)), json.loads(facts.decode("utf-8"))
        except UNDECODABLE:
            self._add_fallback(day, code, data, facts)
            self.drop_tick_raw(day, code)
            return None

    def drop_tick_raw(self, day: str, code: str) -> None:
        self._tick_raw_path(day, code).unlink(missing_ok=True)
        self._tick_meta_path(day, code).unlink(missing_ok=True)

    def tick_raw_codes(self, day: str) -> list[str]:
        folder = self.root / "staging-ticks" / day / "raw"
        if not folder.is_dir():
            return []
        return sorted(path.name[: -len(".json.gz")] for path in folder.glob("*.json.gz")
                      if self._tick_meta_path(day, path.name[: -len(".json.gz")]).is_file())

    # Answers set aside while a whole one is fetched (a stock's fallbacks) are only ever added, never replaced:
    # staging-ticks/<day>/fallback/<code>/<n>.json.gz, with the facts in <n>.json. The fullest one is chosen when
    # the day is published; the others go along as evidence.
    def _fallback_folder(self, day: str, code: str | None = None) -> Path:
        folder = self.root / "staging-ticks" / day / "fallback"
        return folder / code if code else folder

    def _fallback_names(self, day: str, code: str) -> list[str]:
        folder = self._fallback_folder(day, code)
        if not folder.is_dir():
            return []
        return sorted(path.name[: -len(".json.gz")] for path in folder.glob("*.json.gz")
                      if (folder / f"{path.name[: -len('.json.gz')]}.json").is_file())

    def add_tick_fallback(self, day: str, code: str, pages: list, meta: dict) -> None:
        """Sets an answer aside as one more of the stock's fallbacks."""
        self._add_fallback(day, code, gzip.compress(_json_bytes(pages), mtime=0), _json_bytes(meta))

    def _add_fallback(self, day: str, code: str, raw: bytes, meta: bytes) -> None:
        folder = self._fallback_folder(day, code)
        numbers = [int(path.name.split(".")[0]) for path in folder.glob("*.json*")
                   if path.name.split(".")[0].isdigit()] if folder.is_dir() else []
        name = f"{max(numbers, default=0) + 1:04d}"
        _write_atomic(folder / f"{name}.json", meta)
        _write_atomic(folder / f"{name}.json.gz", raw)

    def tick_fallbacks(self, day: str, code: str) -> list[tuple[str, list, dict]]:
        """The stock's fallbacks, oldest first, as (name, answer, facts). One that cannot be decoded is not
        offered; it stays on disk and goes along as evidence."""
        folder = self._fallback_folder(day, code)
        found = []
        for name in self._fallback_names(day, code):
            data, facts = (folder / f"{name}.json.gz").read_bytes(), (folder / f"{name}.json").read_bytes()
            try:
                found.append((name, json.loads(gzip.decompress(data)), json.loads(facts.decode("utf-8"))))
            except UNDECODABLE:
                continue
        return found

    def tick_fallback_codes(self, day: str) -> list[str]:
        folder = self._fallback_folder(day)
        if not folder.is_dir():
            return []
        return sorted(child.name for child in folder.iterdir() if self._fallback_names(day, child.name))

    def use_tick_fallback(self, day: str, code: str, name: str, pages: list, meta: dict) -> None:
        """Makes an answer set aside the stock's answer. The answer it replaces is set aside first, and the one
        used leaves the fallbacks only once copied: a failure at any step leaves every answer on disk."""
        kept = self.load_tick_raw(day, code)
        if kept is not None:
            self.add_tick_fallback(day, code, *kept)
            self.drop_tick_raw(day, code)  # a save cut short then leaves no answer, never old trades with new facts
        self.save_tick_raw(day, code, pages, meta)
        folder = self._fallback_folder(day, code)
        for path in (folder / f"{name}.json.gz", folder / f"{name}.json"):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass  # held by a scanner, say: whatever is left goes along again or with staging; raw/ has the answer

    def has_tick_answers(self, day: str) -> bool:
        """Whether staging holds any answer for the day, kept or set aside, decodable or not."""
        return bool(self.tick_raw_codes(day) or self.tick_fallback_codes(day))

    def pending_tick_days(self, before: str) -> list[str]:
        """Days whose trades (or answers set aside) wait in staging, unpublished, earlier than `before`."""
        staging = self.root / "staging-ticks"
        if not staging.is_dir():
            return []
        return sorted(folder.name for folder in staging.iterdir()
                      if DAY_NAME.match(folder.name) and folder.name < before and not self.has_ticks(folder.name)
                      and self.has_tick_answers(folder.name))

    def publish_ticks(self, day: str, entries: list[dict], trades: dict[str, list], rejected: list[dict],
                      warnings: list[dict], published_at: datetime, source: str, version: str,
                      after_hours: dict[str, list] | None = None) -> dict:
        """Publishes the checked trades plus every answer kept: raw/ holds the answer each stock's trades (or its
        rejection, with the reason in the manifest) come from, fallback/<code>/ the other answers set aside."""
        target = self.root / "ticks" / day
        if target.exists():
            raise FileExistsError(day)
        staging = self.root / "staging-ticks" / day
        out = staging / "day"
        shutil.rmtree(out, ignore_errors=True)
        (out / "symbols").mkdir(parents=True)
        (out / "raw").mkdir()
        files = []

        def put(relative: str, data: bytes) -> None:
            (out / relative).parent.mkdir(parents=True, exist_ok=True)
            (out / relative).write_bytes(data)
            files.append({"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

        for code in sorted(trades):
            payload = {"schema": 1, "code": code, "date": day, "sizeUnit": "lot",
                       "fields": ["msAfter0900", "price", "size", "bid", "ask"], "trades": trades[code],
                       "afterHours": (after_hours or {}).get(code, [])}
            put(f"symbols/{code}.json.gz", gzip.compress(_json_bytes(payload), mtime=0))
        for code in self.tick_raw_codes(day):
            put(f"raw/{code}.json.gz", self._tick_raw_path(day, code).read_bytes())
        for code in self.tick_fallback_codes(day):
            folder = self._fallback_folder(day, code)
            for name in self._fallback_names(day, code):
                put(f"fallback/{code}/{name}.json.gz", (folder / f"{name}.json.gz").read_bytes())
                put(f"fallback/{code}/{name}.json", (folder / f"{name}.json").read_bytes())
        manifest = {"schema": 1, "date": day, "createdAt": published_at.isoformat(timespec="seconds"),
                    "version": version, "source": source, "sizeUnit": "lot",
                    "counts": {"symbols": len(entries), "trades": sum(len(rows) for rows in trades.values())},
                    "symbols": entries, "rejected": rejected, "warnings": warnings, "files": files}
        (out / "manifest.json").write_bytes(_json_bytes(manifest, indent=1))
        target.parent.mkdir(parents=True, exist_ok=True)
        _replace(out, target)
        shutil.rmtree(staging, ignore_errors=True)
        return manifest

    def write_ticks_status(self, entry: dict) -> None:
        status = self.read_status()
        status["ticks"] = entry
        text = self.redact(json.dumps(status, ensure_ascii=False, indent=1))
        _write_atomic(self.root / "status.json", text.encode("utf-8"))

    def reconcile(self) -> None:
        """Repairs a publish interrupted after its day folder moved: index entry and raw evidence."""
        staging_ticks = self.root / "staging-ticks"
        if staging_ticks.is_dir():
            for folder in staging_ticks.iterdir():
                if self.has_ticks(folder.name):
                    shutil.rmtree(folder, ignore_errors=True)
        days = self.root / "days"
        if not days.is_dir():
            return
        listed = {entry["date"] for entry in self._read_json("index.json", {"schema": 1, "days": []})["days"]}
        for folder in sorted(days.iterdir()):
            manifest_path = folder / "manifest.json"
            if not (DAY_NAME.match(folder.name) and manifest_path.is_file()):
                continue
            raw = self.root / "staging" / folder.name / "raw"
            if raw.exists() and not (self.root / "raw" / folder.name).exists():
                (self.root / "raw").mkdir(parents=True, exist_ok=True)
                _replace(raw, self.root / "raw" / folder.name)
            self.discard_staging(folder.name)
            if folder.name not in listed:
                manifest_bytes = manifest_path.read_bytes()
                manifest = json.loads(manifest_bytes)
                self._update_index({"date": folder.name, "coverage": manifest["coverage"],
                                    "symbols": manifest["counts"]["symbols"],
                                    "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                                    "publishedAt": manifest["createdAt"]})

    def _read_json(self, name: str, default: dict) -> dict:
        """A corrupt file is moved aside (name.corrupt-<time>) so one bad write never stops later runs."""
        path = self.root / name
        if not path.is_file():
            return default
        try:
            value = json.loads(path.read_text(encoding="utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            value = None
        if isinstance(value, dict) and all(key in value for key in default):
            return value
        _replace(path, path.with_name(f"{name}.corrupt-{time.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:6]}"))
        return default

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

    # The books recorder (books.py) runs during the session, the fetcher after it: it keeps its own status file
    # and log, so neither ever rewrites the other's.
    def books_raw_folder(self, day: str) -> Path:
        return self.root / "staging-books" / day / "raw"

    def remove_books_staging(self, day: str) -> None:
        shutil.rmtree(self.root / "staging-books" / day, ignore_errors=True)

    def books_log(self, day: str, message: str, at: datetime) -> None:
        path = self.root / "logs" / "books" / f"{day}.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"{at:%Y-%m-%d %H:%M:%S} {self.redact(message)}\n")

    def read_books_status(self) -> dict | None:
        try:
            value = json.loads((self.root / "books-status.json").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError, UnicodeDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def write_books_status(self, entry: dict) -> None:
        text = self.redact(json.dumps(entry, ensure_ascii=False, indent=1))
        _write_atomic(self.root / "books-status.json", text.encode("utf-8"))

    def free_bytes(self) -> int:
        self.root.mkdir(parents=True, exist_ok=True)
        return shutil.disk_usage(self.root).free

    def latest_full_market_codes(self) -> list[str] | None:
        """The latest published full-market day's codes, most traded first (its index is kept in that order)."""
        try:
            days = json.loads((self.root / "index.json").read_text(encoding="utf-8-sig"))["days"]
            day = [entry for entry in days if entry.get("coverage") == "full-market"][-1]["date"]
            listing = json.loads((self.root / "days" / day / "index.json").read_text(encoding="utf-8-sig"))
            return [entry["code"] for entry in listing["symbols"]]
        except (OSError, ValueError, KeyError, IndexError, TypeError):
            return None

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
                age, pid = 0.0, None
                try:
                    age = time.time() - path.stat().st_mtime
                    pid = int(json.loads(path.read_text(encoding="utf-8"))["pid"])
                except FileNotFoundError:
                    continue
                except (OSError, ValueError, KeyError, TypeError):
                    pid = None  # still being written, or damaged: only its age can release it
                held = age <= STALE_LOCK_SECONDS and (pid is None or self._pid_alive(pid))
                if attempt == 1 or held:
                    raise Locked() from None
                path.unlink(missing_ok=True)
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump({"pid": os.getpid(), "startedAt": now.isoformat(timespec="seconds")}, stream)
        try:
            yield
        finally:
            path.unlink(missing_ok=True)
