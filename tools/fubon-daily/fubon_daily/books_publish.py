"""Publishes a recorded day's books (stage 2): compact per-stock files, checked, then moved into books/<day>.

The raw files come from staging-books/<day>/raw (a fresh recording) or raw-books/<day> (a re-publish). Nothing goes
out unless every stock's file decodes back to exactly what was recorded; the checks below only warn. After
publishing, the raw files move to raw-books/<day> and are deleted 14 days later.
"""
from __future__ import annotations

from datetime import datetime

from .books_compact import SIZE_UNIT, encode_day

SOURCE = "fubon-neo websocket books (Speed)"
# Prices outside the day's ±10% limits, with room for the price grid's rounding.
LIMIT = 0.1
LIMIT_TOLERANCE = 0.001


class BooksPublishError(Exception):
    pass


class NoBooks(BooksPublishError):
    """The day's raw files hold no books message at all (every connection failed, or a trial with no data)."""


class Checker:
    """Counts what looks wrong in the decoded books, per stock and kind (decision O): never blocks publishing."""

    def __init__(self, references: dict[str, float] | None):
        self.references = references
        self.previous_t: dict[str, int] = {}
        self.counts: dict[tuple[str, str], int] = {}

    def add(self, code: str, kind: str) -> None:
        self.counts[(code, kind)] = self.counts.get((code, kind), 0) + 1

    def see(self, code: str, frame: dict) -> None:
        previous = self.previous_t.get(code)
        if previous is not None and frame["t"] < previous:
            self.add(code, "time")  # Fubon's own order; its time rarely goes back
        self.previous_t[code] = frame["t"]
        bids = [price for price, _ in frame["bids"]]
        asks = [price for price, _ in frame["asks"]]
        if frame["continuous"]:
            if any(higher <= lower for higher, lower in zip(bids, bids[1:])) \
                    or any(lower >= higher for lower, higher in zip(asks, asks[1:])):
                self.add(code, "order")
            if bids and asks and bids[0] >= asks[0]:
                self.add(code, "crossed")
        reference = (self.references or {}).get(code)
        if reference:
            low = reference * (1 - LIMIT - LIMIT_TOLERANCE)
            high = reference * (1 + LIMIT + LIMIT_TOLERANCE)
            if any(price > 0 and not low <= price <= high for price in bids + asks):
                self.add(code, "limit")

    def warnings(self) -> list[dict]:
        return [{"code": code, "kind": kind, "count": count} for (code, kind), count in sorted(self.counts.items())]


def publish_day(store, day: str, version: str, now: datetime, connections: list[dict] | None = None) -> dict:
    """Publishes one recorded day; returns a summary for the status file. Raises BooksPublishError (or an OSError)
    and leaves the raw files where they were when anything goes wrong."""
    staging_raw = store.books_raw_folder(day)
    archived_raw = store.root / "raw-books" / day
    source = staging_raw if staging_raw.is_dir() else archived_raw
    if not source.is_dir():
        raise BooksPublishError(f"找不到 {day} 的原始五檔")
    if (store.root / "books" / day).exists():
        raise BooksPublishError(f"{day} 的五檔已經上架；要重新上架，先移走 books/{day}")
    references, limit_check = store.limit_references(day)
    checker = Checker(references)
    encoded = encode_day(source, day, check=checker.see)
    if encoded.mismatched:
        raise BooksPublishError(f"{len(encoded.mismatched)} 檔還原後和原始資料不一致，這天不上架："
                                + "、".join(encoded.mismatched[:10]))
    if not encoded.files:
        raise NoBooks(f"{day} 沒有任何五檔資料，不上架")
    symbols = [{"code": code, "messages": encoded.messages[code], "first": encoded.first[code],
                "last": encoded.last[code], "gaps": encoded.gaps.get(code, [])} for code in sorted(encoded.files)]
    manifest = {"schema": 1, "date": day, "createdAt": now.isoformat(timespec="seconds"), "version": version,
                "source": SOURCE, "sizeUnit": SIZE_UNIT, "limitCheck": limit_check,
                "counts": {"symbols": len(symbols), "messages": sum(entry["messages"] for entry in symbols)},
                "symbols": symbols, "connections": connections or [], "warnings": checker.warnings(),
                "unparsable": {"count": encoded.unparsable_count, "examples": encoded.unparsable},
                "truncated": encoded.truncated}
    store.publish_books(day, encoded.files, manifest)
    if source == staging_raw:
        store.archive_books_raw(day)
    store.prune_books(now.date())
    return {"at": manifest["createdAt"], "symbols": manifest["counts"]["symbols"],
            "messages": manifest["counts"]["messages"], "bytes": sum(entry["bytes"] for entry in symbols),
            "warnings": len(manifest["warnings"]), "unparsable": encoded.unparsable_count}
