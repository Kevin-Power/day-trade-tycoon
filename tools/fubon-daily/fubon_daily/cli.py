"""Command line: python fetch_daily.py --data <market-data> --credentials <file> [--date D [--symbols a,b]]
[--radar-config <radar.local.json>]."""
from __future__ import annotations

import argparse
import http.client
import ssl
import time
import urllib.request
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from . import radar, taiex
from .client import FubonClient, sdk_version
from .extras import run_extras
from .pipeline import Options, Runtime, run
from .store import MarketStore

# TWSE downloads use the same (connect, read) = (10, 60) seconds as every other call of the fetcher. urllib's own
# `timeout=` is one number for the connect and for each wait for data afterwards, so the connections below set the
# socket to READ_TIMEOUT once they are connected, and urlopen is given CONNECT_TIMEOUT.
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 60
# A day's answer is about 250 KB; anything this big is not one.
MAX_DOWNLOAD_BYTES = 8_000_000


class ReadTimeout:
    """Mixed into http.client's connections: once connected, each wait for data may last READ_TIMEOUT seconds."""

    def connect(self) -> None:
        super().connect()
        self.sock.settimeout(READ_TIMEOUT)


class _HttpConnection(ReadTimeout, http.client.HTTPConnection):
    pass


class _HttpsConnection(ReadTimeout, http.client.HTTPSConnection):
    pass


class _HttpHandler(urllib.request.HTTPHandler):
    def http_open(self, request):
        return self.do_open(_HttpConnection, request)


class _HttpsHandler(urllib.request.HTTPSHandler):
    def __init__(self) -> None:
        self.tls = ssl.create_default_context()
        super().__init__(context=self.tls)

    def https_open(self, request):
        return self.do_open(_HttpsConnection, request, context=self.tls)


def twse_get(url: str) -> bytes:
    """The body of a public TWSE address, as sent. Any failure (no connection, a timeout, an HTTP error, an answer far
    too big) is an OSError: taiex.fetch turns whatever is raised into one fixed reason."""
    request = urllib.request.Request(url, headers={"User-Agent": taiex.USER_AGENT, "Accept": "application/json"})
    opener = urllib.request.build_opener(_HttpHandler, _HttpsHandler)
    with opener.open(request, timeout=CONNECT_TIMEOUT) as response:
        data = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise OSError("answer too big")
    return data


def default_radar_config() -> Path:
    return Path.home() / ".daytrade-tycoon" / "radar.local.json"


def config_present(path: Path) -> bool:
    """Whether the list is configured. A file that exists but cannot be examined counts as present, so reading it
    fails with a fixed reason instead of passing for 'not configured'."""
    try:
        return Path(path).is_file()
    except OSError:
        return True


def make_extras(radar_config: Path, version: str, *, taiex_get: Callable[[str], bytes] = twse_get,
                read_values: Callable = radar.read_values,
                sleep: Callable[[float], None] = time.sleep) -> Callable[[MarketStore, datetime], None]:
    """What runs after a daily fetch (extras.run_extras): TWSE's index by urllib, the list by `read_values`. The config
    file is looked for when this runs, not when it is made."""

    def read_radar() -> list[list[str]]:
        config = radar.load_config(radar_config)
        if config is None:
            raise radar.RadarError("找不到設定檔")
        return read_values(config)

    def extras(store: MarketStore, now: datetime) -> None:
        run_extras(store, now=now, taiex_get=taiex_get, radar_read=read_radar,
                   radar_config_present=config_present(radar_config), version=version, sleep=sleep)

    return extras


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="抓取富邦上市普通股 1 分 K（只讀行情）")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--credentials", type=Path, required=True)
    parser.add_argument("--date")
    parser.add_argument("--symbols")
    parser.add_argument("--last-attempt", action="store_true")
    parser.add_argument("--radar-config", type=Path, default=default_radar_config())
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
                      source=f"fubon-neo {sdk_version()} historical/candles timeframe=1",
                      extras=make_extras(args.radar_config, version))
    return run(Options(data=args.data, credentials=args.credentials, date=args.date, symbols=args.symbols,
                       last_attempt=args.last_attempt), runtime)
