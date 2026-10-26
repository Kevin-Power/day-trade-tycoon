# 盤中錄真實五檔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every trading day, record Fubon's real-time 五檔 (WebSocket `books`) for every listed common stock from about 08:44 to 13:36, keep it losslessly, and later publish compact per-stock files for ③.

**Architecture:** A second entry point in the existing Python fetcher package (`tools/fubon-daily`). Stage 1 (Tasks 1–6, installed 2026-10-27 after 13:35) logs in once, opens 4 WebSocket connections, writes every books message as received to gzip files, reconnects with backoff, and reports in its own status file. Stage 2 (Tasks 7–9, within 14 days) turns the raw files into compact per-stock files, verifies them by round trip, publishes them and prunes old raw files.

**Tech Stack:** Python 3.12 in `%USERPROFILE%\YilutekServices\DayTradeTycoon\fetcher\.venv`, fubon_neo 2.4.0 / fugle_marketdata 2.7.0rc1 (WebSocket via `sdk.init_realtime()` + `sdk.marketdata.websocket_client.stock`), `unittest`, PowerShell 5.1 `install.ps1`, Windows Task Scheduler.

**Spec:** `docs/superpowers/specs/2026-10-26-fubon-books-recorder-design.md` (approved 2026-10-26). Read it first; decision letters below (A–S) refer to it.

## Global Constraints

- Market data only: never call account or order APIs; never open, print or log anything from `C:\Users\kevin\.fubon\` (read it only through `fubon_daily.credentials.load_credentials`); everything written to disk or shown passes through the `Redactor`.
- All SDK calls stay in `fubon_daily/client.py` (that module's rule).
- Only `event == "data"` messages of channel `books` are stored; login messages are never stored.
- Connections: 4 (decision D), at most 280 books subscriptions each; books only, Speed mode (SDK default).
- Times: Taipei (`TAIPEI` from `normalize.py`); connect from 08:44, closed check at 09:05 (or 5 min after a later start), stop at 13:36.
- Reconnect: silence 70 s = drop; waits 10/20/40/60/120 s + 0–10 s jitter; 4 drops reconnect ≥15 s apart; after 8 failures in a row retry every 300 s until 13:30; error code 1001 → wait 300 s; 120 s up resets the failure count (decision J).
- Raw files flushed every 5 s; a restart opens new files and never appends to or overwrites an earlier one (decisions G, Q).
- Disk: do not start below 10 GB free on the market-data drive; stop recording below 3 GB (decision K).
- REST: 1–2 calls at start; refills after a reconnect at most 2 per second (decisions E, R).
- **Deviation from the spec, decided while planning:** the recorder's status goes to its own `market-data/books-status.json`, not a `books` key in `status.json`, because the daily fetcher read-modify-writes `status.json` and could run at the same time (a boot catch-up). Spec decision M is updated in Task 6.
- **Deviation:** the recorder takes its own lock `market-data/.books.lock`, held for the whole session (about 5 h). It is stale only when its process is gone or it is older than 7 h; the fetcher's 2.5 h rule would let a re-start trigger take over a live recorder.
- Never run the recorder against real Fubon on 2026-10-27 between 08:40 and 13:35 (the other session's whole-day acceptance). Tests use fakes only.
- Commits: `git -c user.name=Claude -c user.email=noreply@anthropic.com commit`, message ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test command (from `tools/fubon-daily`): `py -3.12 -m unittest discover -s tests -t .`. The full suite must pass before every commit.

## Review Focus

1. **`connect()` never returns.** The other session saw this SDK spin before `on_open`. Expect: the attempt gives up after 15 s, that client is abandoned (best-effort `disconnect()`), the next attempt uses a fresh `stock_stream()`, and the loop keeps going. Test in Task 4: `test_a_connect_that_never_returns_is_abandoned`.
2. **Late callbacks from a replaced client.** After a reconnect, an old client can still deliver messages. Expect: they are ignored, never written twice, never counted. Test in Task 3: `test_messages_from_an_older_generation_are_ignored`.
3. **Started after 13:36.** For example, the PC woke at 15:00 and StartWhenAvailable fired. Expect: exit 0 at once with outcome `late`, no login, no files. Test in Task 4: `test_a_start_after_the_stop_time_does_nothing`.
4. **A write fails mid-day.** Disk full or a file held. Expect: recording stops, everything flushed so far stays readable, outcome `partial` with the reason, and a notice. Test in Task 2: `test_a_write_error_stops_the_writer_and_keeps_what_was_flushed`; and in Task 4: `test_a_writer_failure_ends_the_day_as_partial`.
5. **Two recorders at once.** A manual run plus the task, or a re-start trigger while running. Expect: the second exits at once, and the first's lock survives past 2.5 h. Test in Task 5: `test_the_books_lock_is_not_stale_after_three_hours`.

---

## Stage 1 (install 2026-10-27 after 13:35)

### Task 1: Client — extra WebSocket connections and REST quotes

**Files:**
- Modify: `tools/fubon-daily/fubon_daily/client.py` (class `FubonClient`)
- Test: `tools/fubon-daily/tests/test_client.py`

**Interfaces:**
- Produces:
  - `FubonClient.stock_stream() -> object`
    - Returns a WebSocket stock client on its own connection.
    - The first call returns `sdk.marketdata.websocket_client.stock` from `login()`.
    - Every later call runs `init_realtime()` again (through `_call`) and returns the new `websocket_client.stock`.
    - It then sets `self._rest` to the new `rest_client.stock`.
    - An `ApiError` from `init_realtime` propagates.
  - `FubonClient.quote(symbol: str) -> dict`: `_call(lambda: self._rest.intraday.quote(symbol=symbol))`.

- [ ] **Step 1: Write the failing tests.** Extend `FakeSdk`: `init_realtime()` replaces `self.marketdata` with a fresh namespace, and counts its calls. The namespace holds `websocket_client.stock = object()` and `rest_client.stock` with `intraday.quote`.
```python
def test_each_stream_after_the_first_gets_its_own_connection(self):
    sdk = FakeSdk(); client = FubonClient(CREDENTIALS, sdk_factory=lambda: sdk, rest_modules=fake_modules)
    client.login()
    streams = [client.stock_stream() for _ in range(4)]
    self.assertEqual(len({id(s) for s in streams}), 4)
    self.assertEqual(sdk.realtime_calls, 4)          # login's + three more
    client.quote("2330")
    self.assertEqual(sdk.requests[-1], ("quote", {"symbol": "2330"}))  # through the newest REST client

def test_a_failed_extra_connection_raises_api_error(self): ...  # init_realtime raising SdkError(…, 503) -> ApiError
```
- [ ] **Step 2: Run them; confirm they fail** (AttributeError: `stock_stream`).
- [ ] **Step 3: Implement both methods** with an `_issued` counter on the client.
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: extra Fubon WebSocket connections and REST quotes for the books recorder`.

### Task 2: Raw writer and symbol groups

**Files:**
- Create: `tools/fubon-daily/fubon_daily/books.py` (constants, `split_symbols`, `RawWriter`)
- Test: `tools/fubon-daily/tests/test_books.py`

**Interfaces:**
- Produces:
  - **Constants**, exactly: `CONNECTIONS = 4`, `PER_CONNECTION = 280`, `OPEN_AT = time(8, 44)`, `CLOSED_CHECK = time(9, 5)`, `STOP_AT = time(13, 36)`, `SILENCE_SECONDS = 70`, `CONNECT_TIMEOUT = 15`, `BACKOFF = (10, 20, 40, 60, 120)`, `JITTER_SECONDS = 10`, `STAGGER_SECONDS = 15`, `FAST_FAILURES = 8`, `SLOW_RETRY_SECONDS = 300`, `FULL_WAIT_SECONDS = 300`, `RETRY_UNTIL = time(13, 30)`, `STABLE_SECONDS = 120`, `FLUSH_SECONDS = 5`, `STATUS_EVERY = 300`, `REFILL_WAIT = 30`, `REFILL_SPACING = 0.5`, `DOWN_NOTICE_SECONDS = 600`, `MIN_FREE_START = 10 * 2**30`, `MIN_FREE_RUN = 3 * 2**30`.
  - `split_symbols(codes: list[str], connections: int = CONNECTIONS, per_connection: int = PER_CONNECTION) -> tuple[list[list[str]], list[str]]`
    - `codes` arrive most traded first. Deal them round-robin into `connections` groups, at most `per_connection` each.
    - Returns the groups and the codes that did not fit, in input order.
  - `RawWriter(folder: Path, name: str)`:
    - `write(record: dict) -> int` returns the bytes written.
    - `flush() -> None`, `close() -> None`.
    - File: `folder / f"{name}-{HH}-{part}.jsonl.gz"`, where `HH` is the Taipei hour of `record["r"]` (ms since epoch). `part` is the first of 1, 2, … whose file does not exist yet, checked when an hour's file is first opened.
    - One JSON object per line, compact separators, `ensure_ascii=False`.
    - `flush()` does a gzip sync flush, so a crash keeps every flushed line readable.
    - After any `OSError`, the writer is `failed` (attribute `error: str | None`), and later writes are dropped and return 0.

- [ ] **Step 1: Write the failing tests:**
  - `test_symbols_are_dealt_round_robin_most_traded_first` — 1,057 codes → 4 groups of 265/264/264/264, none dropped. Group 0 starts with codes[0], codes[4].
  - `test_codes_beyond_four_times_280_are_reported` — 1,130 codes → 1,120 kept, 10 dropped (the last 10).
  - `test_records_go_to_hourly_files_and_read_back` — records at 08:59:59.900 and 09:00:00.100 Taipei → `conn1-08-1.jsonl.gz` and `conn1-09-1.jsonl.gz`.
  - `test_a_restart_never_appends_to_an_earlier_file` — a second writer for the same hour writes `-2`. The first file is unchanged.
  - `test_flushed_lines_survive_a_crash` — write 3 lines, flush, write 1 more, do not close, then copy the file. Reading the copy with `gzip` up to the first error yields the 3 flushed lines.
  - `test_a_write_error_stops_the_writer_and_keeps_what_was_flushed` — patch the handle's `write` to raise `OSError`. The writer becomes failed, the next write returns 0, and earlier flushed lines still read back.
- [ ] **Step 2: Run them; confirm they fail** (module missing).
- [ ] **Step 3: Implement** `split_symbols` and `RawWriter` (use `gzip.GzipFile(fileobj=open(path, "xb"))` and `flush(zlib.Z_SYNC_FLUSH)`).
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: books recorder raw files and connection groups`.

### Task 3: Stream (one connection's messages, generations, health)

**Files:**
- Modify: `tools/fubon-daily/fubon_daily/books.py` (class `Stream`, class `Backoff`)
- Test: `tools/fubon-daily/tests/test_books.py`

**Interfaces:**
- Consumes: `RawWriter` (Task 2).
- Produces:
  - `Backoff(random: Callable[[], float])`:
    - `failure(now: float, full: bool = False) -> float`: seconds to wait.
      - `BACKOFF[min(n, 4)] + random() * JITTER_SECONDS` while failures in a row are < `FAST_FAILURES`, else `SLOW_RETRY_SECONDS`.
      - `full=True` (error 1001) → `FULL_WAIT_SECONDS`.
    - `connected(now: float)`.
    - `tick(now: float)`: resets the count once connected for ≥ `STABLE_SECONDS`.
    - `failures: int`.
  - `Stream(index: int, codes: list[str], writer: RawWriter, monotonic: Callable[[], float], wall_ms: Callable[[], int])`:
    - `attach(client) -> int`: new generation; registers `message`, `disconnect`, `error` callbacks that capture the generation; returns it.
    - `on_message(generation: int, message) -> None`:
      - Accepts str, bytes or dict.
      - Older generation → ignored.
      - Any parsable event updates `last_seen` (monotonic).
      - `subscribed` → add acknowledged symbols, set `acknowledged_at`.
      - `data` on channel `books` → writer gets `{"r": wall_ms(), "d": data}`. Then `messages += 1`, `last_books[symbol] = wall_ms()`, `bytes += written`.
      - `error` with `data.code == 1001` → `full = True`; any error is kept, redacted by the caller later, in `errors` (last 20).
    - `on_disconnect(generation, *args)` → `down = True` for the current generation only.
    - `mark(event: str, **values)`: writes a control line `{"r": wall_ms(), "ev": event, **values}`. Events: `connected`, `subscribed`, `down`, `stop`, `refill`.
    - `silent(now: float) -> bool`: `now - last_seen > SILENCE_SECONDS`.
    - State fields: `generation`, `down`, `full`, `messages`, `bytes`, `last_seen`, `acknowledged_at`, `last_books: dict[str, int]`, `gaps: list[dict]`, `reconnects`, `errors`.

- [ ] **Step 1: Write the failing tests:**
  - `test_books_data_is_written_as_received`: a real-shaped message (Global fixture `BOOK` in `tests/fixtures.py`: symbol 2330, 5 bids, 5 asks, `time` µs, `isContinuous`) → exactly one line `{"r": …, "d": BOOK}`.
  - `test_login_and_heartbeat_messages_are_not_stored`: `authenticated` and `heartbeat` → no data lines, but `last_seen` moves.
  - `test_messages_from_an_older_generation_are_ignored`: attach twice; a message for generation 1 → not written, not counted.
  - `test_error_1001_asks_for_the_long_wait`: `{"event":"error","data":{"code":1001,"message":"Maximum number of connections reached"}}` → `full` is True.
  - `test_backoff_waits_grow_then_slow_down`: `random=lambda: 0.5` → failures give 15, 25, 45, 65, 125, 125, 125, 125, then 300. `full=True` → 300. A connection that has been up 120 s resets the count.
  - `test_silence_counts_heartbeats_too`.
- [ ] **Step 2: Run them; confirm they fail.**
- [ ] **Step 3: Implement** `Backoff` and `Stream`.
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: books stream state, generations and reconnect backoff`.

### Task 4: Recorder (the session loop)

**Files:**
- Modify: `tools/fubon-daily/fubon_daily/books.py` (class `BooksRuntime`, class `Recorder`)
- Modify: `tools/fubon-daily/fubon_daily/store.py`:
  - add `books_raw_folder(day) -> Path` (`staging-books/<day>/raw`);
  - add `books_log(day, message, at)` (`logs/books/<day>.log`, redacted);
  - add `write_books_status(entry: dict)` (`books-status.json`, atomic, redacted);
  - add `free_bytes() -> int` (`shutil.disk_usage(self.root).free`).
- Test: `tools/fubon-daily/tests/test_books.py` (with a `FakeStreamClient` and a `FakeBooksClient` in the test file, and a `Clock` like `test_pipeline.Clock` that also drives wall time).

**Interfaces:**
- Consumes:
  - `FubonClient.login/stock_stream/quote/snapshot_quotes/logout` (Task 1).
  - `split_symbols`, `RawWriter`, `Stream`, `Backoff` (Tasks 2–3).
  - `snapshot_listing` (normalize.py).
  - `load_credentials`, `Redactor`.
  - `notify` and `NOTIFY_TITLE` (pipeline.py).
- Produces:
  - `BooksRuntime` dataclass: `make_client`, `now`, `monotonic`, `sleep`, `notify`, `random`, `version`, `connect_timeout=CONNECT_TIMEOUT`.
  - `Recorder(data: Path, credentials: Path, runtime: BooksRuntime, store: MarketStore, stop_at: time = STOP_AT, test_mode: bool = False)`.
  - `.run() -> int` returns the exit code: 0 for `ok`/`closed`/`late`/`partial`, 1 for `failed`, 2 for a credentials or login problem.
  - Outcomes written to `books-status.json`:
    ```json
    {"schema": 1, "date": "YYYY-MM-DD",
     "outcome": "running|ok|partial|closed|late|failed",
     "reason": null, "startedAt": "…", "updatedAt": "…", "finishedAt": null,
     "symbols": 1057, "dropped": [],
     "messages": 0, "rawBytes": 0,
     "connections": [{"index": 1, "symbols": 265, "messages": 0, "reconnects": 0, "up": true,
                      "gaps": [{"from": "…", "to": "…", "reason": "…"}]}],
     "version": "…"}
    ```
  - Behaviour, in order:
    1. Stop time already passed → `late`, no login.
    2. `free_bytes() < MIN_FREE_START` → `failed` plus a notice.
    3. Wait until `OPEN_AT`. Test mode skips this wait.
       - **Restart the same day:** if `books-status.json` already holds today with outcome `running` or `partial` (a crash, then a re-start trigger), carry over its counts, connections and gaps.
       - Add a gap for every connection from its `updatedAt` to now, with reason `程式重新啟動`. The final outcome can then be at best `partial`.
    4. Login. Credential, login or SDK errors → exit 2 plus a notice.
    5. Symbol list:
       - Normal: `snapshot_listing(snapshot_quotes())`, ranked by `trade_value`. Every listing counts, including stocks with no volume.
       - If the snapshot fails: the latest full-market `days/<d>/index.json`.
       - If both fail: `failed`.
    6. For each group: `stock_stream()`, `attach`, connect (in a thread, `connect_timeout`), subscribe `{"channel": "books", "symbols": group}`, `mark("connected")`. Start each connection ≥ `STAGGER_SECONDS` after the previous one.
    7. Main loop, every second until the stop time:
       - flush every `FLUSH_SECONDS`;
       - reconnect a stream that is `down` or `silent` (see below);
       - run refills;
       - write status every `STATUS_EVERY`;
       - check free space every 60 s; below `MIN_FREE_RUN` → stop as `partial`;
       - a writer that failed → stop as `partial`;
       - a stream down longer than `DOWN_NOTICE_SECONDS` → one notice per incident.
    8. Closed check: at `CLOSED_CHECK` (or start + 5 min, if later), no books data on any stream, and at least one stream got a `subscribed` → `closed`. Then remove `staging-books/<day>`, no notice. Not in test mode.
    9. End: `mark("stop")`, best-effort `disconnect()` of every client, `logout()`, close writers, final status (`ok` if no gap and no stop reason, else `partial`). A notice if not `ok`/`closed`/`late`.
  - **Reconnect of a stream:**
    - Append a gap `{"from": iso(last_seen as wall time), "to": None, "reason": …}` and `mark("down")`.
    - Wait per `Backoff`. Keep the stagger: no two reconnects start less than `STAGGER_SECONDS` apart.
    - Get a fresh `stock_stream()` (in a thread, `connect_timeout`). Abandon the old client with a best-effort `disconnect()`.
    - Attach, connect, subscribe.
    - On `subscribed`, close the gap (`to`) and arm a refill at `acknowledged_at + REFILL_WAIT`.
    - Stop retrying after `RETRY_UNTIL`.
  - **Refills:** for each code of a stream armed and due, with no `last_books[code]` after `acknowledged_at`:
    - `quote(code)`, one call every `REFILL_SPACING` seconds;
    - write `{"r": …, "src": "rest", "d": answer}`;
    - `mark("refill", symbol=code)`.
    - Errors are counted, not retried.

- [ ] **Step 1: Write the failing tests** (fake client: `stock_stream()` returns `FakeStreamClient`s that record subscribes and can `emit(message)`, `drop()`, hang on `connect`, or answer 1001; fake clock):
  - `test_a_start_after_the_stop_time_does_nothing` — now 15:00 → outcome `late`, no `login` call, no `staging-books`.
  - `test_too_little_disk_space_does_not_start` — `free_bytes` 9 GB → `failed`, one notice, no login.
  - `test_every_listed_stock_is_subscribed_on_four_connections` — a snapshot of 1,057 → 4 `stock_stream()` calls and 4 subscribes with 265/264/264/264 symbols. Connections start ≥15 s apart.
  - `test_books_are_recorded_until_the_stop_time` — emit 3 books messages, advance past 13:36 → raw files hold 3 data lines plus `connected`/`stop` lines. Outcome `ok`, `messages: 3`, `logout` called.
  - `test_a_dropped_connection_comes_back_and_its_gap_is_recorded` — drop stream 2 at 10:00. A new `stock_stream()` arrives after 10–20 s, is resubscribed with the same symbols, and the gap has `from`/`to`. Outcome `partial`.
  - `test_silence_is_a_drop` — no messages at all on stream 3 for 71 s → reconnect.
  - `test_a_connect_that_never_returns_is_abandoned` — the first connect of a reconnect hangs. After 15 s a fresh client is tried, and the hung one gets `disconnect()`.
  - `test_reconnects_are_staggered` — all 4 drop together → the reconnect attempts are ≥15 s apart.
  - `test_after_eight_failures_retry_every_five_minutes_until_1330` — every connect fails. Waits switch to 300 s, and no attempt starts after 13:30.
  - `test_error_1001_waits_five_minutes`.
  - `test_quiet_stocks_are_refilled_after_a_reconnect` — after the resubscribe, 2 of 3 codes get books within 30 s. The third gets one `quote()`, written with `"src": "rest"`. Quotes are ≥0.5 s apart.
  - `test_a_market_holiday_ends_as_closed` — subscribed, heartbeats only, until 09:05 → `closed`, staging removed, no notice.
  - `test_a_writer_failure_ends_the_day_as_partial`.
  - `test_low_disk_during_the_day_stops_as_partial`.
  - `test_a_long_drop_sends_one_notice`.
  - `test_secrets_never_reach_status_or_log` — login fails with a message containing the PERSON_ID → status and log hold the mask.
  - `test_a_restart_the_same_day_keeps_the_earlier_counts_and_records_the_gap` — a status file for today, `running`, `updatedAt` 10:00, 5,000 messages; a new run at 10:30 → the messages carry over, every connection gets a 10:00–10:30 gap, the outcome is `partial`.
- [ ] **Step 2: Run them; confirm they fail.**
- [ ] **Step 3: Implement** `BooksRuntime`, `Recorder` and the store additions.
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: books recorder session loop with reconnects, refills and status`.

### Task 5: Entry point, lock and installer

**Files:**
- Create: `tools/fubon-daily/record_books.py` (like `fetch_daily.py`, calls `fubon_daily.books_cli.main`)
- Create: `tools/fubon-daily/fubon_daily/books_cli.py`
- Modify: `tools/fubon-daily/fubon_daily/store.py`: `lock(self, now, name=".lock", stale_seconds=STALE_LOCK_SECONDS)`. The fetcher's callers stay unchanged.
- Modify: `tools/fubon-daily/install.ps1`:
  - `-App` also copies `record_books.py`.
  - New switch `-BooksTask`.
- Test: `tools/fubon-daily/tests/test_books_cli.py`, `tests/test_store.py`, `tests/test_install_script.py`

**Interfaces:**
- Produces:
  - `books_cli.main(argv: list[str] | None = None) -> int`.
    - Args: `--data PATH` (required), `--credentials PATH` (required), `--stop-at HH:MM` (default `13:36`), `--test`.
    - `--test` skips the 08:44 wait and the holiday check, for off-hours trials against a scratch `--data`.
    - Holds `store.lock(now, name=".books.lock", stale_seconds=7 * 3600)`; `Locked` → log one line, exit 0.
  - Scheduled task `DayTradeTycoonBooks`, created by `install.ps1 -BooksTask`:
    - Execute: `fetcher\.venv\Scripts\pythonw.exe`, arguments `-X utf8 "<fetcher>\app\record_books.py" --data "<runtime>\market-data" --credentials "<creds>"`.
    - Working directory `fetcher\work-books`, created by the script.
    - Weekly Monday–Friday triggers at `'08:40', '09:30', '10:30', '11:30', '12:30'`. The later ones restart a crashed recorder; a running one makes Windows ignore them.
    - Settings: `-StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)`.
    - Principal: Interactive, Limited, same as the fetcher.

- [ ] **Step 1: Write the failing tests:**
  - `test_the_books_lock_is_not_stale_after_three_hours` — a lock 3 h old whose pid is alive → `Locked`.
  - `test_a_books_lock_of_a_dead_process_is_taken`.
  - `test_cli_passes_stop_time_and_test_mode`.
  - `test_a_second_recorder_exits_at_once`.
  - Installer tests:
    - Scope the existing `-MultipleInstances` assertion to the `DayTradeTycoonMarketData` block, so it stays `Queue`.
    - New `test_the_books_task_starts_at_0840_with_restart_triggers`, which parses the books block's `$booksTriggers` list.
    - New `test_the_books_task_ignores_a_second_start_and_restarts_on_failure`.
    - New `test_app_install_copies_record_books`.
- [ ] **Step 2: Run them; confirm they fail.**
- [ ] **Step 3: Implement** the CLI, the entry script, the lock parameter and the installer changes. Save `install.ps1` as UTF-8 **with BOM** if it gains any non-ASCII text (PowerShell 5.1 quirk).
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: record_books entry point, books lock and DayTradeTycoonBooks task`.

### Task 6: Docs, off-hours trial and stage-1 review

**Files:**
- Modify: `tools/fubon-daily/README.md`: new section 「盤中五檔（2026-10-28 起）」 covering what it records, the schedule, files, status, reconnects, disk guards, and how to run a trial with `--test`.
- Modify: `docs/superpowers/specs/2026-10-26-fubon-books-recorder-design.md`: decision M now names `books-status.json`; record the lock rule.
- Create: `docs/fubon-books-2026-10-27.md`, the install record. Fill it in during Task 6 and at install.

- [ ] **Step 1: Write the README and spec edits.**
- [ ] **Step 2: Off-hours trial.** Not on 10/27 08:40–13:35.
  - Run `fetcher\.venv\Scripts\python.exe -X utf8 tools\fubon-daily\record_books.py --data <scratchpad>\books-trial\market-data --credentials %USERPROFILE%\.fubon\credentials.local.py --test --stop-at <now+2min>` from the worktree.
  - Expected:
    - exit 0, outcome `ok`;
    - 4 connections with 1,000+ symbols acknowledged;
    - raw files containing `connected` and `stop` control lines;
    - no data lines (market closed);
    - `books-status.json` and `logs/books/<day>.log` free of secrets.
- [ ] **Step 3: Fresh whole-stage review.** A reviewer reads the diff from `bc54c0c` against the spec and this plan. Fix Critical and Important findings with tests first, then rerun the suite.
- [ ] **Step 4: Commit** `docs: books recorder guide and stage-1 record`.

### Install (2026-10-27, after 13:35 and before 16:30; the user approved this window on 2026-10-26)

- [ ] Confirm the other session's acceptance has ended (13:35 passed; no collector process from `docs/fubon-session-acceptance-2026-10-27.md` still running). If unsure, ask the user before installing.
- [ ] Fast-forward or merge `claude/fubon-books` into `codex/course-handover` in the main checkout, touching only this branch's files. The main checkout holds another session's uncommitted files: do not stage them.
- [ ] `install.ps1 -App` from the merged commit.
  - Hash-compare the installed files.
  - Smoke-run `fetch_daily.py` (before 16:30 it only logs and exits 0).
- [ ] `install.ps1 -BooksTask`. Check `Get-ScheduledTask DayTradeTycoonBooks`: triggers, settings, next run 2026-10-28 08:40.
- [ ] Record in `docs/fubon-books-2026-10-27.md`.
  - Rollback: `Unregister-ScheduledTask DayTradeTycoonBooks`, then `install.ps1 -App` at the previous VERSION.
- [ ] Ask the user before pushing.

---

## Stage 2 (within 14 days of the first recording)

### Task 7: Compact per-stock files and round-trip verification

**Files:**
- Create: `tools/fubon-daily/fubon_daily/books_compact.py`
- Test: `tools/fubon-daily/tests/test_books_compact.py`

**Interfaces:**
- Consumes: raw files from Task 2 (`staging-books/<day>/raw/conn*-HH-*.jsonl.gz`), including control lines and `"src": "rest"` lines.
- Produces:
  - `encode_day(raw_folder: Path, day: str) -> dict[str, bytes]`: gzip bytes per stock code.
  - `decode(blob: bytes) -> list[dict]`: frames `{"t": msAfter0900, "trial": bool, "src": "ws"|"rest", "bids": [[price, size], …], "asks": [[price, size], …]}` in time order.
  - `gaps_by_symbol(raw_folder: Path) -> dict[str, list[[fromMs, toMs]]]`.
    - Sources: `down`/`subscribed` control lines and `refill` lines.
    - A restart counts as a gap: a `connected` line in a later part file, with no `stop` before it, opens a gap from the last line of the earlier part.
    - A stock's gap ends at its first books message or refill after the resubscribe.
  - Per-stock file schema 1: `{"schema": 1, "code", "date", "sizeUnit": "unverified", "keyEvery": 60000, "gaps": [[fromMs, toMs]], "rows": [...]}`.
    - Each row is `[dt, flags, payload]`. `dt` is milliseconds since the previous row (the first is since 09:00).
    - `flags`: bit0 = trial, bit1 = rest refill, bit2 = full frame.
    - `payload` is either all levels `[[p, s] × nb, [p, s] × na]` (a full frame: the first row, the first row of each minute, the first row after a gap) or `[[level, p, s], …]` for changed levels. Levels 0–4 are bids and 5–9 asks; `p = null` means the level emptied.
    - Message time is Fubon `time` (µs) → ms after 09:00 of `day`. REST rows use their own time field, or their receive time when it has none.
- [ ] **Step 1: Write the failing tests:**
  - `test_round_trip_equals_the_raw_messages` — use 300 real-shaped messages from a fixture built from the 2026-10-22 spike's shape, with trial frames and 4-level books.
  - `test_every_minute_starts_with_a_full_frame`.
  - `test_a_gap_is_kept_and_the_next_row_is_full`.
  - `test_a_crash_and_restart_is_a_gap`.
  - `test_rest_refills_are_flagged`.
  - `test_unparsable_lines_are_reported_not_dropped_silently`.
- [ ] **Step 2: Run; confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite; all pass.**
- [ ] **Step 5: Commit** `feat: compact per-stock books files with full frames each minute`.

### Task 8: Publish, checks and raw retention

**Files:**
- Modify: `tools/fubon-daily/fubon_daily/books.py` (call publishing after the stop when the outcome is not `closed`/`late`)
- Modify: `tools/fubon-daily/fubon_daily/store.py`:
  - `publish_books(day, files, manifest)`: staging, then an atomic rename to `books/<day>/`;
  - move the raw folder to `raw-books/<day>/`;
  - `prune` also deletes `raw-books/<day>` after 14 days and `logs/books/*.log` after 90.
- Modify: `tools/fubon-daily/fubon_daily/books_cli.py`: `--publish YYYY-MM-DD` re-publishes a day from its raw files. This covers days recorded before stage 2.
- Test: `tests/test_books_publish.py`, `tests/test_store.py`

**Interfaces:**
- Produces: `books/<day>/manifest.json`:
  - per stock: `{"code", "messages", "first", "last", "gaps", "path", "bytes", "sha256"}`;
  - also: `connections` (gaps), `warnings`, `sizeUnit: "unverified"`, `source: "fubon-neo websocket books (Speed)"`, `version`.
- **Checks** (decision O; each failure is a warning, never a block):
  - time order;
  - in continuous frames, bids strictly descending, asks strictly ascending, and bid1 < ask1;
  - prices inside the day's limits (`referencePrice` ±10% on the price grid, from that day's `days/<day>/index.json` when present).
- **Raw retention:** never delete a raw day that has no published `books/<day>/manifest.json`.
- [ ] **Step 1: Failing tests:**
  - `test_publish_is_atomic_and_lists_every_file_hash`;
  - `test_a_crossed_book_is_a_warning_not_a_block`;
  - `test_raw_is_kept_until_published_then_pruned_after_14_days`;
  - `test_republish_from_raw_matches_the_first_publish`.
- [ ] **Step 2: Confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full suite passes.**
- [ ] **Step 5: Commit** `feat: publish books days with checks and 14-day raw retention`.

### Task 9: First-day evidence and stage-2 install

- [ ] **Analyse a recorded day.** This is a one-off script in the scratchpad, not product code. Measure:
  - messages, gaps and size per stock;
  - CPU and memory, from the log;
  - **size unit**: around each trade from `ticks/<day>` that hits the best ask, check whether the ask-1 size drops by the trade's lots or by lots × 1000;
  - **cross-check**: each trade's bid/ask equals the book's best level at that moment.
  - Record the results in `docs/fubon-books-2026-10-27.md`.
- [ ] **If the unit is confirmed** (a separate small change): set `sizeUnit` in new manifests to `"lot"` or `"share"`.
- [ ] **Fresh review of Tasks 7–8.** Install with the user's OK, outside 08:40–13:40 and 16:30–19:50. `--publish` every day recorded so far.
