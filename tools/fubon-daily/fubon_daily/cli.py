"""Command line: python fetch_daily.py --data <market-data> --credentials <file> [--date D [--symbols a,b]]."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from .client import FubonClient, sdk_version
from .pipeline import Options, Runtime, run


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取富邦上市普通股 1 分 K（只讀行情）")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--date")
    parser.add_argument("--symbols")
    parser.add_argument("--last-attempt", action="store_true")
    args = parser.parse_args(argv)
    if args.date is not None:
        try:
            day = date.fromisoformat(args.date)
        except ValueError:
            parser.error("--date 必須是 YYYY-MM-DD")
        if day > date.today():
            parser.error("--date 不可是未來的日期")
    if args.symbols is not None:
        if args.date is None:
            parser.error("--symbols 必須搭配 --date")
        args.symbols = [code.strip() for code in args.symbols.split(",") if code.strip()]
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    version_file = Path(__file__).resolve().parent.parent / "VERSION.txt"
    version = version_file.read_text(encoding="ascii").strip() if version_file.is_file() else "dev"
    runtime = Runtime(make_client=lambda credentials: FubonClient(credentials), version=version,
                      source=f"fubon-neo {sdk_version()} historical/candles timeframe=1")
    return run(Options(data=args.data, credentials=args.credentials, date=args.date, symbols=args.symbols,
                       last_attempt=args.last_attempt), runtime)
