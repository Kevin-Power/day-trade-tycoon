import base64
import hashlib
import http.server
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock
from urllib.parse import quote

from fubon_daily import radar
from fubon_daily.normalize import TAIPEI
from fubon_daily.radar import HEADER, RADAR_FIRST_DAY, RadarConfig, RadarError
from fubon_daily.store import MarketStore


def has_google_auth():
    try:
        return importlib.util.find_spec("google.auth") is not None
    except ImportError:  # no "google" package at all (find_spec raises instead of answering None)
        return False


GOOGLE = has_google_auth()
MARKER = "LEAK-MARKER-7f3a"
NOW = datetime(2026, 10, 28, 16, 50, tzinfo=TAIPEI)
SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"


def row(day, kind, code, name, *rest):
    """A sheet row: the first four columns as given, the others (族群 … 備註) filled in like the real sheet."""
    cells = [day, kind, code, name, "半導體", "88", "A", "1000", "1.5", "0", ""]
    cells[4:4 + len(rest)] = rest
    return cells


class HeaderTest(unittest.TestCase):
    def reason(self, values):
        with self.assertRaises(RadarError) as caught:
            radar.parse_values(values)
        return caught.exception.reason

    def test_header_must_match(self):
        self.assertEqual(HEADER, ["日期", "類型", "代號", "名稱", "族群", "分數", "等級", "收盤", "漲跌幅%", "連板", "備註"])
        for header in (HEADER[:-1], HEADER[1:], HEADER + ["多一欄"], HEADER[1:2] + HEADER[:1] + HEADER[2:],
                       [name.replace("名稱", "股名") for name in HEADER], []):
            with self.subTest(header=header):
                self.assertEqual(self.reason([header, row("2026-10-27", "當沖", "2330", "台積電")]), "試算表欄位改了")

    def test_empty_sheet_is_a_changed_header(self):
        self.assertEqual(self.reason([]), "試算表欄位改了")

    def test_header_alone_is_an_empty_list(self):
        self.assertEqual(radar.parse_values([HEADER]), ({}, 0))

    def test_error_text_is_the_reason(self):
        self.assertEqual(str(RadarError("試算表欄位改了")), "試算表欄位改了")


class ParseValuesTest(unittest.TestCase):
    def test_only_daytrade_rows_deduped(self):
        values = [HEADER,
                  row("2026-10-27", "當沖", "2330", "台積電"),
                  row("2026-10-27", "當沖", "2330", "台積電"),
                  row("2026-10-27", "隔日衝", "2317", "鴻海"),
                  row("2026-10-27", "當沖", "6488", "環球晶")]
        lists, skipped = radar.parse_values(values)
        self.assertEqual(lists, {"2026-10-27": [("2330", "台積電"), ("6488", "環球晶")]})
        self.assertEqual(skipped, 0)

    def test_otc_codes_are_not_filtered_here(self):
        # 上櫃 stocks are left to the site, which knows the listings.
        lists, _ = radar.parse_values([HEADER, row("2026-10-27", "當沖", "6488", "環球晶")])
        self.assertEqual(lists["2026-10-27"], [("6488", "環球晶")])

    def test_each_day_has_its_own_list_in_sheet_order(self):
        values = [HEADER,
                  row("2026-10-27", "當沖", "2330", "台積電"),
                  row("2026-10-26", "當沖", "2330", "台積電"),
                  row("2026-10-26", "當沖", "2317", "鴻海"),
                  row("2026-10-27", "當沖", "1101", "台泥")]
        lists, _ = radar.parse_values(values)
        self.assertEqual(lists, {"2026-10-27": [("2330", "台積電"), ("1101", "台泥")],
                                 "2026-10-26": [("2330", "台積電"), ("2317", "鴻海")]})

    def test_a_repeated_code_keeps_its_first_name(self):
        values = [HEADER, row("2026-10-27", "當沖", "2330", "台積電"), row("2026-10-27", "當沖", "2330", "別的名字")]
        self.assertEqual(radar.parse_values(values)[0], {"2026-10-27": [("2330", "台積電")]})

    def test_a_day_without_daytrade_rows_is_absent(self):
        lists, skipped = radar.parse_values([HEADER, row("2026-10-27", "隔日衝", "2317", "鴻海")])
        self.assertEqual((lists, skipped), ({}, 0))

    def test_bad_rows_skipped_and_counted(self):
        values = [HEADER,
                  row("2026/10/27", "當沖", "2330", "台積電"),   # date not YYYY-MM-DD
                  row("2026-10-27", "當沖", "", "台積電"),       # code blank
                  row("2026-10-27", "當沖", "2317", ""),         # name blank
                  row("2026-10-27", "當沖", "6488", "環球晶")]
        lists, skipped = radar.parse_values(values)
        self.assertEqual(lists, {"2026-10-27": [("6488", "環球晶")]})
        self.assertEqual(skipped, 3)

    def test_code_rule(self):
        good = ["2330", "00940", "00679B", "ABCD", "A1B2C3"]
        bad = ["233", "2330000", "2330 5", "2330.0", "abcd", "00679b", "２３３０", "23-30"]
        values = [HEADER] + [row("2026-10-27", "當沖", code, f"名{index}") for index, code in enumerate(good + bad)]
        lists, skipped = radar.parse_values(values)
        self.assertEqual([code for code, _ in lists["2026-10-27"]], good)
        self.assertEqual(skipped, len(bad))

    def test_date_must_be_a_real_day(self):
        values = [HEADER, row("2026-13-45", "當沖", "2330", "台積電"), row("2026-02-30", "當沖", "2317", "鴻海"),
                  row("2026-1-5", "當沖", "1101", "台泥")]
        self.assertEqual(radar.parse_values(values), ({}, 3))

    def test_cells_are_trimmed(self):
        lists, skipped = radar.parse_values([HEADER, row(" 2026-10-27 ", " 當沖 ", " 2330 ", " 台積電 ")])
        self.assertEqual((lists, skipped), ({"2026-10-27": [("2330", "台積電")]}, 0))

    def test_short_and_blank_rows(self):
        # The sheet leaves out trailing empty cells, and a blank line is no row at all.
        values = [HEADER, ["2026-10-27", "當沖", "2330", "台積電"], [], ["", "", ""], ["2026-10-27", "當沖", "2317"],
                  ["2026-10-27", "當沖"], ["2026-10-27", "隔日衝", "bad code", ""]]
        lists, skipped = radar.parse_values(values)
        self.assertEqual(lists, {"2026-10-27": [("2330", "台積電")]})
        self.assertEqual(skipped, 2)  # only the two unfinished 當沖 rows; other kinds are not ours to judge

    def test_a_row_without_a_kind_is_bad_but_other_kinds_are_not_counted(self):
        values = [HEADER, row("2026-10-27", "", "2330", "台積電"), row("2026/10/27", "隔日衝", "", "")]
        self.assertEqual(radar.parse_values(values), ({}, 1))

    def test_cells_that_are_not_text_are_bad(self):
        lists, skipped = radar.parse_values([HEADER, ["2026-10-27", "當沖", 2330, "台積電"],
                                             ["2026-10-27", "當沖", "2317", None], "not a row"])
        self.assertEqual((lists, skipped), ({}, 3))

    def test_scores_and_grades_are_not_returned(self):
        lists, _ = radar.parse_values([HEADER, row("2026-10-27", "當沖", "2330", "台積電", "半導體", "93", "S")])
        self.assertNotIn("93", json.dumps(lists, ensure_ascii=False))
        self.assertEqual(lists["2026-10-27"][0], ("2330", "台積電"))


class DatesToStoreTest(unittest.TestCase):
    def test_dates_to_store(self):
        lists = {"2026-10-19": [("2330", "台積電")],   # before RADAR_FIRST_DAY
                 "2026-10-20": [("2330", "台積電")],   # the first day
                 "2026-10-21": [("2330", "台積電")],   # stored already
                 "2026-10-27": [("2330", "台積電")],
                 "2026-10-28": [("2330", "台積電")],   # today: not frozen yet
                 "2026-10-29": [("2330", "台積電")]}   # in the future
        self.assertEqual(RADAR_FIRST_DAY, date(2026, 10, 20))
        self.assertEqual(radar.dates_to_store(lists, {"2026-10-21"}, date(2026, 10, 28)), ["2026-10-20", "2026-10-27"])

    def test_nothing_new(self):
        lists = {"2026-10-27": [("2330", "台積電")]}
        self.assertEqual(radar.dates_to_store(lists, {"2026-10-27"}, date(2026, 10, 28)), [])
        self.assertEqual(radar.dates_to_store({}, set(), date(2026, 10, 28)), [])

    def test_the_result_is_sorted_and_empty_days_are_left_out(self):
        lists = {"2026-10-27": [("2330", "台積電")], "2026-10-22": [("2317", "鴻海")], "2026-10-23": []}
        self.assertEqual(radar.dates_to_store(lists, set(), date(2026, 10, 28)), ["2026-10-22", "2026-10-27"])

    def test_the_first_day_is_in_and_today_is_out_exactly(self):
        lists = {"2026-10-20": [("2330", "台積電")]}
        self.assertEqual(radar.dates_to_store(lists, set(), date(2026, 10, 20)), [])
        self.assertEqual(radar.dates_to_store(lists, set(), date(2026, 10, 21)), ["2026-10-20"])


class RadarStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "market-data"
        self.store = MarketStore(self.root)
        self.symbols = [("2330", "台積電"), ("6488", "環球晶")]

    def tearDown(self):
        self.temp.cleanup()

    def path(self, day="2026-10-27"):
        return self.root / "radar" / f"{day}.json"

    def log(self, day="2026-10-28"):
        path = self.root / "logs" / f"{day}.log"
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def test_nothing_stored_yet(self):
        self.assertEqual(self.store.radar_dates(), [])
        self.assertIsNone(self.store.read_radar("2026-10-27"))

    def test_write_radar_stores_codes_and_names_only(self):
        self.assertTrue(self.store.write_radar("2026-10-27", self.symbols, NOW))
        stored = json.loads(self.path().read_text(encoding="utf-8"))
        symbols = [{"code": "2330", "name": "台積電"}, {"code": "6488", "name": "環球晶"}]
        canonical = json.dumps(symbols, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        self.assertEqual(stored, {"schema": 1, "date": "2026-10-27", "kind": "當沖", "fetchedAt": "2026-10-28T16:50:00+08:00",
                                  "sha256": hashlib.sha256(canonical).hexdigest(), "symbols": symbols})
        self.assertEqual(self.store.read_radar("2026-10-27"), stored)
        self.assertEqual(self.store.radar_dates(), ["2026-10-27"])

    def test_write_radar_is_write_once(self):
        self.assertTrue(self.store.write_radar("2026-10-27", self.symbols, NOW))
        before = self.path().read_bytes()
        later = datetime(2026, 10, 28, 18, 0, tzinfo=TAIPEI)
        self.assertFalse(self.store.write_radar("2026-10-27", [("2330", "台積電"), ("2317", "鴻海")], later))
        self.assertEqual(self.path().read_bytes(), before)
        self.assertEqual(self.store.read_radar("2026-10-27")["symbols"][1], {"code": "6488", "name": "環球晶"})
        self.assertIn("試算表的 2026-10-27 名單和已存的不同", self.log())
        self.assertEqual(len(self.log().splitlines()), 1)

    def test_a_changed_name_is_a_different_list(self):
        self.store.write_radar("2026-10-27", self.symbols, NOW)
        self.assertFalse(self.store.write_radar("2026-10-27", [("2330", "台積電"), ("6488", "新名字")], NOW))
        self.assertIn("試算表的 2026-10-27 名單和已存的不同", self.log())

    def test_the_same_list_again_is_false_and_quiet(self):
        self.store.write_radar("2026-10-27", self.symbols, NOW)
        before = self.path().read_bytes()
        self.assertFalse(self.store.write_radar("2026-10-27", list(self.symbols), datetime(2026, 10, 28, 18, 0, tzinfo=TAIPEI)))
        self.assertEqual(self.path().read_bytes(), before)
        self.assertEqual(self.log(), "")

    def test_the_same_stocks_in_another_order_is_not_a_change(self):
        self.store.write_radar("2026-10-27", self.symbols, NOW)
        self.assertFalse(self.store.write_radar("2026-10-27", self.symbols[::-1], NOW))
        self.assertEqual(self.log(), "")

    def test_a_stored_list_that_cannot_be_read_is_kept_and_logged(self):
        self.path().parent.mkdir(parents=True)
        self.path().write_text("{not json", encoding="utf-8")
        self.assertIsNone(self.store.read_radar("2026-10-27"))
        self.assertFalse(self.store.write_radar("2026-10-27", self.symbols, NOW))
        self.assertEqual(self.path().read_text(encoding="utf-8"), "{not json")
        self.assertIn("已存的 2026-10-27 名單讀不出來", self.log())

    def test_read_radar_checks_the_file(self):
        self.store.write_radar("2026-10-27", self.symbols, NOW)
        good = json.loads(self.path().read_text(encoding="utf-8"))
        broken = {
            "wrong schema": {**good, "schema": 2},
            "wrong date": {**good, "date": "2026-10-26"},
            "wrong kind": {**good, "kind": "隔日衝"},
            "altered symbols": {**good, "symbols": good["symbols"][:1]},
            "wrong hash": {**good, "sha256": "0" * 64},
            "symbols not a list": {**good, "symbols": "2330"},
            "symbol without a name": {**good, "symbols": [{"code": "2330"}]},
            "not an object": [good],
        }
        for label, value in broken.items():
            with self.subTest(label):
                self.path().write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
                self.assertIsNone(self.store.read_radar("2026-10-27"))
        self.path().write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(self.store.read_radar("2026-10-27"), good)

    def test_radar_dates_lists_stored_days_in_order(self):
        for day in ("2026-10-27", "2026-10-20", "2026-10-22"):
            self.store.write_radar(day, self.symbols, NOW)
        (self.root / "radar" / "notes.json").write_text("{}", encoding="utf-8")
        (self.root / "radar" / ".2026-10-30.json.abc.tmp").write_text("{}", encoding="utf-8")
        self.assertEqual(self.store.radar_dates(), ["2026-10-20", "2026-10-22", "2026-10-27"])

    def test_a_day_is_a_day_name_and_nothing_else(self):
        for day in ("../2026-10-27", "2026-10-27/../x", "latest", ""):
            with self.subTest(day=day):
                with self.assertRaises(ValueError):
                    self.store.write_radar(day, self.symbols, NOW)
                with self.assertRaises(ValueError):
                    self.store.read_radar(day)
        self.assertFalse((self.root / "radar").exists())

    def test_an_empty_list_is_never_frozen(self):
        with self.assertRaises(ValueError):
            self.store.write_radar("2026-10-27", [], NOW)
        self.assertEqual(self.store.radar_dates(), [])

    def test_a_date_works_as_well_as_its_name(self):
        self.assertTrue(self.store.write_radar(date(2026, 10, 27), self.symbols, NOW))
        self.assertEqual(self.store.read_radar(date(2026, 10, 27))["date"], "2026-10-27")


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write(self, value, name="radar.local.json"):
        path = self.dir / name
        path.write_text(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), encoding="utf-8")
        return path

    def test_missing_config_is_none(self):
        self.assertIsNone(radar.load_config(self.dir / "radar.local.json"))

    def test_config_is_read_and_the_key_is_relative_to_it(self):
        path = self.write({"sheetId": "1AbC-dEf_123", "tab": "定格名單", "keyFile": "google-radar-reader.json"})
        config = radar.load_config(path)
        self.assertEqual(config, RadarConfig("1AbC-dEf_123", "定格名單", self.dir / "google-radar-reader.json"))

    def test_a_utf8_bom_is_fine(self):
        path = self.dir / "radar.local.json"
        path.write_bytes(b"\xef\xbb\xbf" + json.dumps({"sheetId": "abc", "tab": "t", "keyFile": "k.json"}).encode())
        self.assertEqual(radar.load_config(path).sheet_id, "abc")

    def test_key_inside_git_refused(self):
        (self.dir / ".git").mkdir()
        path = self.write({"sheetId": "abc", "tab": "定格名單", "keyFile": "google-radar-reader.json"})
        with self.assertRaises(RadarError) as caught:
            radar.load_config(path)
        self.assertEqual(caught.exception.reason, "金鑰檔不能放在 git 專案裡")

    def test_a_key_outside_git_is_fine_even_when_the_config_is_not_next_to_it(self):
        keys = Path(tempfile.mkdtemp(dir=self.dir))
        project = self.dir / "project"
        (project / ".git").mkdir(parents=True)
        path = self.write({"sheetId": "abc", "tab": "t", "keyFile": str(keys / "key.json")}, "radar.local.json")
        self.assertEqual(radar.load_config(path).key_path, keys / "key.json")
        # ... and a key that points into a project is refused wherever the config lives.
        path = self.write({"sheetId": "abc", "tab": "t", "keyFile": str(project / "key.json")}, "other.json")
        with self.assertRaises(RadarError) as caught:
            radar.load_config(path)
        self.assertEqual(caught.exception.reason, "金鑰檔不能放在 git 專案裡")

    def test_bad_config_format(self):
        good = {"sheetId": "abc", "tab": "定格名單", "keyFile": "key.json"}
        bad = {
            "not json": "{sheetId: abc",
            "empty file": "",
            "a list": [good],
            "no sheet id": {k: v for k, v in good.items() if k != "sheetId"},
            "no tab": {k: v for k, v in good.items() if k != "tab"},
            "no key file": {k: v for k, v in good.items() if k != "keyFile"},
            "blank tab": {**good, "tab": "  "},
            "number key file": {**good, "keyFile": 5},
            "sheet id with a slash": {**good, "sheetId": "abc/../../x"},
            "sheet id with a question mark": {**good, "sheetId": "abc?x=1"},
            "empty sheet id": {**good, "sheetId": ""},
        }
        for label, value in bad.items():
            with self.subTest(label):
                with self.assertRaises(RadarError) as caught:
                    radar.load_config(self.write(value))
                self.assertEqual(caught.exception.reason, "設定檔格式不正確")

    def test_a_config_that_is_a_folder_is_a_format_error(self):
        (self.dir / "radar.local.json").mkdir()
        with self.assertRaises(RadarError) as caught:
            radar.load_config(self.dir / "radar.local.json")
        self.assertEqual(caught.exception.reason, "設定檔格式不正確")


class MissingLibraryTest(unittest.TestCase):
    def test_missing_google_auth_has_its_own_reason(self):
        hidden = {name: None for name in ("google", "google.oauth2", "google.auth", "google.auth.transport",
                                          "google.auth.transport.requests", "google.auth.exceptions")}
        config = RadarConfig("abc", "定格名單", Path("never-opened.json"))
        with mock.patch.dict(sys.modules, hidden):
            with self.assertRaises(RadarError) as caught:
                radar.read_values(config, base_url="http://127.0.0.1:1")
        self.assertEqual(caught.exception.reason, "沒有安裝 google-auth")
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)


class FakeToken(http.server.BaseHTTPRequestHandler):
    """Stands in for Google's token endpoint: records the request and answers with the server's status."""

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.server.requests.append(self.rfile.read(length).decode())
        if self.server.slow:
            self.server.release.wait(10)
            return
        if self.server.status == 200:
            body = {"access_token": "fake-access-token", "expires_in": 3600, "token_type": "Bearer"}
        else:
            body = {"error": "invalid_grant", "error_description": f"{MARKER} says no"}
        self.reply(self.server.status, body)

    def reply(self, status, body):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass


class FakeSheets(FakeToken):
    """Stands in for the Sheets API: records the path and the Authorization header of every GET."""

    def do_GET(self):
        self.server.requests.append((self.path, self.headers.get("Authorization")))
        if self.server.slow:
            self.server.release.wait(10)
            return
        body = self.server.body
        if body is None:
            body = {"error": {"code": self.server.status, "message": f"{MARKER} in the answer"}}
        self.reply(self.server.status, body)


@unittest.skipUnless(GOOGLE, "needs google-auth: run with .venv-test\\Scripts\\python.exe")
class GoogleFakeTest(unittest.TestCase):
    """The real google-auth against two servers on this computer, with a key made here. Google is never called."""

    ROWS = [HEADER, row("2026-10-27", "當沖", "2330", "台積電"), ["2026-10-27", "隔日衝", "2317", "鴻海"]]

    @classmethod
    def setUpClass(cls):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption()).decode()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.token = self.serve(FakeToken)
        self.sheets = self.serve(FakeSheets, body={"range": "定格名單!A1:K3", "majorDimension": "ROWS", "values": self.ROWS})
        self.key_path = Path(self.temp.name) / "google-radar-reader.json"
        self.write_key()
        self.config = RadarConfig("SHEET-ID-1", "定格名單", self.key_path)

    def serve(self, handler, status=200, body=None):
        server = http.server.HTTPServer(("127.0.0.1", 0), handler)
        server.status, server.body, server.requests, server.slow = status, body, [], False
        server.release = threading.Event()
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.release.set)  # first: lets an answer held back finish, so that shutdown can
        server.url = f"http://127.0.0.1:{server.server_port}"
        return server

    def write_key(self, **changes):
        info = {"type": "service_account", "project_id": "fake-project", "private_key_id": f"{MARKER}-key-id",
                "private_key": self.pem, "client_email": f"{MARKER}@fake-project.iam.gserviceaccount.com",
                "client_id": "1234567890", "token_uri": self.token.url + "/token"}
        info.update(changes)
        self.key_path.write_text(json.dumps(info), encoding="utf-8")

    def read_failure(self):
        with self.assertRaises(RadarError) as caught:
            radar.read_values(self.config, base_url=self.sheets.url)
        return caught.exception

    def assertFixed(self, error, reason):
        self.assertEqual(error.reason, reason)
        self.assertEqual(str(error), reason)
        self.assertNotIn(MARKER, str(error) + repr(error) + "".join(map(str, error.args)))
        self.assertNotIn(self.pem.splitlines()[1], str(error) + repr(error))
        self.assertIsNone(error.__cause__)
        self.assertTrue(error.__suppress_context__)

    def test_reads_values_with_service_account(self):
        values = radar.read_values(self.config, base_url=self.sheets.url)
        self.assertEqual(values, self.ROWS)
        (path, authorization), = self.sheets.requests
        self.assertEqual(authorization, "Bearer fake-access-token")
        self.assertEqual(path, f"/v4/spreadsheets/SHEET-ID-1/values/{quote('定格名單!A:K', safe='')}")
        # The sign-in asked for the read-only scope, as the key's own account, at the key's own token address.
        (form,) = self.token.requests
        self.assertIn("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer", form)
        assertion = dict(part.split("=", 1) for part in form.split("&"))["assertion"]
        claims = json.loads(base64.urlsafe_b64decode(assertion.split(".")[1] + "=="))
        self.assertEqual(claims["scope"], SCOPE)
        self.assertEqual(claims["iss"], f"{MARKER}@fake-project.iam.gserviceaccount.com")

    def test_an_empty_range_is_no_rows(self):
        self.sheets.body = {"range": "定格名單!A1:K1000", "majorDimension": "ROWS"}
        self.assertEqual(radar.read_values(self.config, base_url=self.sheets.url), [])

    def test_a_trailing_slash_on_the_base_url_is_fine(self):
        self.assertEqual(radar.read_values(self.config, base_url=self.sheets.url + "/"), self.ROWS)

    def test_http_error_reason_is_fixed(self):
        self.sheets.status, self.sheets.body = 403, None
        error = self.read_failure()
        self.assertFixed(error, "讀不到試算表（HTTP 403）")
        self.assertEqual(len(self.sheets.requests), 1)

    def test_other_http_statuses_name_their_number(self):
        for status in (404, 429, 500):
            with self.subTest(status=status):
                self.sheets.status, self.sheets.body = status, None
                self.assertFixed(self.read_failure(), f"讀不到試算表（HTTP {status}）")

    def test_token_failure_reason_is_fixed(self):
        self.token.status = 400
        error = self.read_failure()
        self.assertFixed(error, "Google 授權失敗")
        self.assertEqual(self.sheets.requests, [])

    def test_an_answer_that_is_not_rows_is_not_read(self):
        for label, body in (("values not a list", {"values": "oops"}), ("rows not lists", {"values": ["a", "b"]}),
                            ("not an object", ["values"]), ("not json", b"<html>MARKER</html>")):
            with self.subTest(label):
                self.sheets.body = body
                self.assertFixed(self.read_failure(), "讀不到試算表（HTTP 200）")

    def test_missing_key_file_reason(self):
        self.key_path.unlink()
        self.assertFixed(self.read_failure(), "找不到 Google 金鑰檔")

    def test_a_key_that_is_a_folder_cannot_be_read(self):
        self.key_path.unlink()
        self.key_path.mkdir()
        self.assertFixed(self.read_failure(), "找不到 Google 金鑰檔")

    def test_a_damaged_key_file_is_an_authorization_failure(self):
        for label, text in (("not json", f"{{ {MARKER} "), ("a list", f'["{MARKER}"]'), ("no fields", "{}"),
                            ("a private key that is no key", json.dumps({
                                "type": "service_account", "private_key_id": MARKER, "client_email": f"{MARKER}@x.test",
                                "private_key": f"-----BEGIN PRIVATE KEY-----\n{MARKER}\n-----END PRIVATE KEY-----\n",
                                "token_uri": self.token.url + "/token"}))):
            with self.subTest(label):
                self.key_path.write_text(text, encoding="utf-8")
                self.assertFixed(self.read_failure(), "Google 授權失敗")
        self.assertEqual(self.token.requests, [])

    def test_no_answer_in_time_is_a_timeout(self):
        self.sheets.slow = True
        with mock.patch.object(radar, "TIMEOUT", (2, 0.3)):
            self.assertFixed(self.read_failure(), "連線逾時")

    def test_no_token_in_time_is_a_timeout(self):
        self.token.slow = True
        with mock.patch.object(radar, "TIMEOUT", (2, 0.3)):
            self.assertFixed(self.read_failure(), "連線逾時")

    def test_no_connection_is_a_timeout_too(self):
        import requests

        real = requests.Session.request

        def refuse_the_sheet(session, method, url, *args, **kwargs):
            if url.startswith(self.sheets.url):
                raise requests.exceptions.ConnectionError(f"{MARKER} refused {url}")
            return real(session, method, url, *args, **kwargs)

        with mock.patch.object(requests.Session, "request", refuse_the_sheet):
            self.assertFixed(self.read_failure(), "連線逾時")
        self.assertEqual(len(self.token.requests), 1)  # signed in first, then the sheet could not be reached

    def test_the_timeout_is_ten_seconds_to_connect_and_sixty_to_read(self):
        self.assertEqual(radar.TIMEOUT, (10, 60))


if __name__ == "__main__":
    unittest.main()
