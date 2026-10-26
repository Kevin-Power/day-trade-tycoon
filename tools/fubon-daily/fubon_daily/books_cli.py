"""Command line: python record_books.py --data <market-data> --credentials <file> [--stop-at HH:MM] [--test]."""
from __future__ import annotations

import argparse
from datetime import time
from pathlib import Path

from .books import BOOKS_LOCK, BOOKS_LOCK_STALE_SECONDS, BooksRuntime, Recorder
from .client import FubonClient
from .store import Locked, MarketStore


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="錄富邦盤中五檔（只讀行情）")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--stop-at", default="13:36")
    parser.add_argument("--test", action="store_true",
                        help="試跑：不等 08:44、不判斷休市。請搭配另一個 --data，不要用正式的 market-data")
    args = parser.parse_args(argv)
    try:
        hour, minute = (int(part) for part in args.stop_at.split(":"))
        args.stop_at = time(hour, minute)
    except ValueError:
        parser.error("--stop-at 必須是 HH:MM")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    version_file = Path(__file__).resolve().parent.parent / "VERSION.txt"
    version = version_file.read_text(encoding="ascii").strip() if version_file.is_file() else "dev"
    runtime = BooksRuntime(make_client=lambda credentials: FubonClient(credentials), version=version)
    store = MarketStore(args.data)
    started = runtime.now()
    try:
        with store.lock(started, name=BOOKS_LOCK, stale_seconds=BOOKS_LOCK_STALE_SECONDS):
            return Recorder(args.data, args.credentials, runtime, store, stop_at=args.stop_at,
                            test_mode=args.test).run()
    except Locked:
        store.books_log(started.date().isoformat(), "另一個五檔錄製程式仍在執行，這次略過", started)
        return 0
