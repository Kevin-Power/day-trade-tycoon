"""Command line: python record_books.py --data <market-data> --credentials <file> [--stop-at HH:MM] [--test]
[--no-publish], or --publish YYYY-MM-DD to publish one recorded day without logging in."""
from __future__ import annotations

import argparse
import re
from datetime import date, time
from pathlib import Path

from .books import BOOKS_LOCK, BOOKS_LOCK_STALE_SECONDS, BooksRuntime, Recorder
from .books_publish import BooksPublishError, publish_day
from .client import FubonClient
from .store import Locked, MarketStore


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="錄富邦盤中五檔（只讀行情）")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--stop-at", default="13:36")
    parser.add_argument("--test", action="store_true",
                        help="試跑：不等 08:44、不判斷休市。請搭配另一個 --data，不要用正式的 market-data")
    parser.add_argument("--no-publish", action="store_true", help="只錄，收盤後不整理上架（第一階段）")
    parser.add_argument("--publish", metavar="YYYY-MM-DD",
                        help="不錄，把那天錄到的原始五檔整理、還原比對後上架；不用登入")
    args = parser.parse_args(argv)
    try:
        hour, minute = (int(part) for part in args.stop_at.split(":"))
        args.stop_at = time(hour, minute)
    except ValueError:
        parser.error("--stop-at 必須是 HH:MM")
    if args.publish is not None:
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.publish):
                raise ValueError(args.publish)
            date.fromisoformat(args.publish)
        except ValueError:
            parser.error("--publish 必須是 YYYY-MM-DD")
    return args


def publish_only(store: MarketStore, day: str, runtime: BooksRuntime) -> int:
    """One recorded day's books, under the recorder's lock so it never runs while a session records."""
    started = runtime.now()
    try:
        with store.lock(started, name=BOOKS_LOCK, stale_seconds=BOOKS_LOCK_STALE_SECONDS):
            status = store.read_books_status()
            connections = status.get("connections") if status and status.get("date") == day else None
            try:
                summary = publish_day(store, day, runtime.version, runtime.now(), connections=connections)
            except (BooksPublishError, OSError) as error:
                message = f"{day} 上架失敗，原始資料留著：{error}"
                store.books_log(started.date().isoformat(), message, runtime.now())
                print(store.redact(message))
                return 1
            message = (f"{day} 上架：{summary['symbols']} 檔、{summary['messages']} 筆、"
                       f"{summary['bytes'] / 2**20:.1f} MB、警告 {summary['warnings']} 項")
            store.books_log(started.date().isoformat(), message, runtime.now())
            print(message)
            return 0
    except Locked:
        message = "五檔錄製程式正在執行，稍後再上架"
        store.books_log(started.date().isoformat(), message, started)
        print(message)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    version_file = Path(__file__).resolve().parent.parent / "VERSION.txt"
    version = version_file.read_text(encoding="ascii").strip() if version_file.is_file() else "dev"
    runtime = BooksRuntime(make_client=lambda credentials: FubonClient(credentials), version=version)
    store = MarketStore(args.data)
    if args.publish is not None:
        return publish_only(store, args.publish, runtime)
    started = runtime.now()
    try:
        with store.lock(started, name=BOOKS_LOCK, stale_seconds=BOOKS_LOCK_STALE_SECONDS):
            return Recorder(args.data, args.credentials, runtime, store, stop_at=args.stop_at,
                            test_mode=args.test, publish=not args.no_publish).run()
    except Locked:
        store.books_log(started.date().isoformat(), "另一個五檔錄製程式仍在執行，這次略過", started)
        return 0
