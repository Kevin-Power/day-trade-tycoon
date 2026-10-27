"""One read-only SDK session. The Node supervisor owns retries and deadlines.

stdin: desired symbol list; stdout: allowlisted market data only. No order/account
operations, listener, credentials, or SDK errors are exposed to the web client.
"""
from __future__ import annotations

import argparse
import contextlib
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import queue
import re
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parent / "credentials"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "fubon-daily" / "fubon_daily"))
from credentials import load_credentials  # copied from the daily fetcher's AST-only reader

OUTPUT = sys.stdout
PREFIX = "FUBON_FEED "
OUTPUT_LOCK = threading.Lock()
FIELDS = ("symbol", "type", "exchange", "date", "name", "referencePrice", "previousClose",
          "price", "size", "time", "serial", "volume", "lastUpdated", "closePrice", "closeTime",
          "isTrial", "isContinuous", "isOpen", "isClose", "isLimitUpHalt", "isLimitDownHalt",
          "isDelayedOpen", "isDelayedClose")


def project(data):
    if not isinstance(data, dict):
        return {}
    result = {key: data[key] for key in FIELDS if key in data}
    for side in ("bids", "asks"):
        if isinstance(data.get(side), list):
            result[side] = [{k: item[k] for k in ("price", "size") if k in item}
                            for item in data[side][:6] if isinstance(item, dict)]
    if isinstance(data.get("lastTrade"), dict):
        result["lastTrade"] = {k: data["lastTrade"][k] for k in ("price", "size", "time", "serial")
                               if k in data["lastTrade"]}
    return result


def emit(kind, **values):
    with OUTPUT_LOCK:
        OUTPUT.write(PREFIX + json.dumps({"kind": kind, **values}, ensure_ascii=True, allow_nan=False) + "\n")
        OUTPUT.flush()


def run(credentials_path, verification=False):
    from importlib.metadata import version
    if version("fubon_neo") != "2.4.0" or version("fugle-marketdata") != "2.7.0rc1":
        emit("fatal", code="SDK_VERSION")
        return
    from fubon_neo.sdk import FubonSDK
    from fugle_marketdata.rest import base_rest
    import requests

    class TimedRequests:
        @staticmethod
        def get(*args, **kwargs):
            kwargs["timeout"] = (5, 10)
            return requests.get(*args, **kwargs)
    base_rest.requests = TimedRequests
    try:
        credentials = load_credentials(Path(credentials_path))
    except Exception:
        emit("fatal", code="CREDENTIALS")
        return
    sdk = FubonSDK()
    stock = None
    events = queue.Queue(maxsize=2000)
    commands = queue.Queue(maxsize=8)
    broken = threading.Event()
    eof = threading.Event()
    verify_disconnect = threading.Event()

    def enqueue(message):
        try:
            events.put_nowait(json.loads(message))
        except (ValueError, queue.Full):
            broken.set()

    def read_commands():
        for line in sys.stdin:
            if len(line) > 4096:
                broken.set()
                break
            try:
                command = json.loads(line)
                if verification and command == {"verifyDisconnect": True}:
                    verify_disconnect.set()
                    continue
                symbols = command["symbols"]
                if (set(command) != {"symbols"} or not isinstance(symbols, list) or len(symbols) > 30
                        or any(not isinstance(s, str) or not re.fullmatch(r"[0-9]{4}", s) for s in symbols)):
                    raise ValueError()
                commands.put_nowait(set(symbols))
            except (ValueError, KeyError, TypeError, queue.Full):
                broken.set()
                break
        eof.set()
        # Also covers a parent crash during SDK.connect()'s unbounded loop.
        timer = threading.Timer(5, lambda: os._exit(0))
        timer.daemon = True
        timer.start()

    threading.Thread(target=read_commands, daemon=True).start()
    try:
        emit("state", state="connecting")
        result = sdk.apikey_login(credentials.person_id, credentials.api_key,
                                  credentials.cert_path, credentials.cert_password)
        if not result.is_success:
            emit("fatal", code="LOGIN_FAILED")
            return
        del result  # account list is never serialized or retained
        sdk.init_realtime()
        stock = sdk.marketdata.websocket_client.stock
        rest = sdk.marketdata.rest_client.stock
        stock.on("message", enqueue)
        def disconnected(*args):
            broken.set()
            emit("fault", code="DISCONNECTED")
        stock.on("disconnect", disconnected)
        stock.on("error", disconnected)
        # connect() in this SDK can spin indefinitely before on_open; the parent
        # kills this entire worker after its start deadline, including SDK threads.
        stock.connect()
        emit("state", state="syncing")
        desired, pending, active, due, validated = set(), {}, {}, {}, set()
        metadata, metadata_checked = {}, {}
        last_inbound = last_ping = last_pulse = time.monotonic()
        rest_allowed = 0.0
        while not broken.is_set() and not eof.is_set():
            now = time.monotonic()
            if verify_disconnect.is_set():
                stock.disconnect()
                break
            while not commands.empty():
                desired = commands.get_nowait()
            for key, subscription_id in list(active.items()):
                if key[1] not in desired and key not in pending:
                    stock.unsubscribe({"id": subscription_id})
                    pending[key] = now
            for symbol in sorted(desired):
                if symbol not in validated:
                    continue
                for channel in ("trades", "books"):
                    key = (channel, symbol)
                    if key not in active and key not in pending:
                        stock.subscribe({"channel": channel, "symbol": symbol})
                        pending[key] = now
            if any(now - started > 20 for started in pending.values()):
                emit("fault", code="SUBSCRIPTION_TIMEOUT")
                break
            try:
                message = events.get(timeout=0.05)
            except queue.Empty:
                message = None
            if message:
                last_inbound = now
                event, data = message.get("event"), message.get("data")
                if event in ("subscribed", "unsubscribed"):
                    for item in data if isinstance(data, list) else [data]:
                        if not isinstance(item, dict):
                            continue
                        key = (item.get("channel"), item.get("symbol"))
                        if event == "subscribed" and key in pending and isinstance(item.get("id"), str):
                            active[key] = item["id"]
                            pending.pop(key, None)
                            due[key[1]] = 0
                            emit("ack", channel=key[0], symbol=key[1])
                        elif event == "unsubscribed":
                            for old, sid in list(active.items()):
                                if sid == item.get("id"):
                                    active.pop(old, None)
                                    pending.pop(old, None)
                                    due.pop(old[1], None)
                                    emit("unack", channel=old[0], symbol=old[1])
                elif event in ("data", "snapshot") and isinstance(data, dict):
                    key = (message.get("channel"), data.get("symbol"))
                    if key in active and active[key] == message.get("id") and key[1] in desired:
                        emit("quote", channel=key[0], sourceEvent=event, data=project(data))
                elif event == "error":
                    emit("fault", code="BROKER_ERROR")
                    break
                elif event in ("heartbeat", "pong", "authenticated"):
                    emit("heartbeat")
            if now - last_inbound > 70:
                emit("fault", code="HEARTBEAT_TIMEOUT")
                break
            if now - last_ping >= 25:
                stock.ping("readonly")
                last_ping = now
            if now - last_pulse >= 2:
                emit("pulse")
                last_pulse = now
            # Serial snapshots: at most 2/sec; 30 symbols/min steady state. A
            # 429 applies a shared 65s cooldown, never an immediate retry storm.
            if now >= rest_allowed:
                candidates = [s for s in desired if (s not in validated or (("books", s) in active and ("trades", s) in active))
                              and now >= due.get(s, 0)]
                if candidates:
                    symbol = min(candidates, key=lambda s: (due.get(s, 0), s))
                    due[symbol] = now + 60
                    rest_allowed = now + 0.5
                    try:
                        today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
                        if (symbol not in validated or (metadata.get(symbol) != today
                                and now - metadata_checked.get(symbol, 0) >= 60)):
                            ticker = rest.intraday.ticker(symbol=symbol)
                            if (ticker.get("symbol") != symbol or ticker.get("type") != "EQUITY"
                                    or ticker.get("exchange") not in ("TWSE", "TPEx", "TPEX")):
                                raise ValueError()
                            validated.add(symbol)
                            metadata[symbol] = ticker.get("date")
                            metadata_checked[symbol] = now
                            emit("bounds", data={k: ticker[k] for k in ("symbol", "date", "limitUpPrice", "limitDownPrice") if k in ticker})
                            due[symbol] = now + 0.5
                            continue
                        snapshot = rest.intraday.quote(symbol=symbol)
                        if (snapshot.get("symbol") != symbol or snapshot.get("type") != "EQUITY"
                                or snapshot.get("exchange") not in ("TWSE", "TPEx", "TPEX")):
                            raise ValueError()
                        # Verify an unknown code BEFORE subscription: an invalid
                        # watchlist entry must not break healthy subscriptions.
                        if ("books", symbol) in active and ("trades", symbol) in active:
                            emit("quote", channel="snapshot", data=project(snapshot))
                    except Exception as error:
                        code = getattr(error, "status_code", None)
                        rest_allowed = now + (65 if code == 429 else 2)
                        emit("symbol_error", symbol=symbol, code="SNAPSHOT_RATE_LIMIT" if code == 429 else "SNAPSHOT_FAILED")
        emit("fault", code="DISCONNECTED")
    except Exception:
        emit("fault", code="CONNECTION_FAILED")
    finally:
        if stock:
            with contextlib.suppress(Exception):
                stock.disconnect()
        with contextlib.suppress(Exception):
            sdk.logout()
        with contextlib.suppress(Exception):
            sdk.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--credentials", required=True)
    parser.add_argument("--verification", action="store_true")
    args = parser.parse_args()
    # SDK prints/errors can contain login details. They are discarded. Only our
    # dedicated allowlisted protocol is consumed by the parent, never raw logs.
    with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        run(args.credentials, args.verification)
    os._exit(0)
