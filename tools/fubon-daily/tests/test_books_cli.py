import json
import os
import tempfile
import unittest
from datetime import time
from pathlib import Path
from unittest import mock

from fubon_daily.books_cli import main, parse_args


class BooksCliTest(unittest.TestCase):
    def test_cli_passes_stop_time_and_test_mode(self):
        args = parse_args(["--data", "md", "--credentials", "c.py", "--stop-at", "10:05", "--test"])
        self.assertEqual((args.data.name, args.stop_at, args.test), ("md", time(10, 5), True))
        args = parse_args(["--data", "md", "--credentials", "c.py"])
        self.assertEqual((args.stop_at, args.test), (time(13, 36), False))

    def test_a_bad_stop_time_is_refused(self):
        for value in ("25:00", "1336", "ab:cd"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                parse_args(["--data", "md", "--credentials", "c.py", "--stop-at", value])

    def test_publish_takes_a_date(self):
        args = parse_args(["--data", "md", "--credentials", "c.py", "--publish", "2026-10-28"])
        self.assertEqual(args.publish, "2026-10-28")
        for value in ("2026-13-01", "20261028", "2026-10-28/../x"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                parse_args(["--data", "md", "--credentials", "c.py", "--publish", value])

    def test_the_session_publishes_unless_told_not_to(self):
        for extra, publish in (([], True), (["--no-publish"], False)):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as folder, \
                    mock.patch("fubon_daily.books_cli.Recorder") as recorder:
                recorder.return_value.run.return_value = 0
                main(["--data", str(Path(folder) / "md"), "--credentials", "c.py", *extra])
                self.assertEqual(recorder.call_args.kwargs["publish"], publish)

    def test_publish_turns_a_recorded_day_into_books_without_logging_in(self):
        from tests.test_books_compact import Raw, at, book

        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / "market-data"
            raw = Raw(data / "staging-books" / "2026-10-28" / "raw")
            raw.control("connected", at(9, 0), generation=1, symbols=1, codes=["2330"])
            raw.control("subscribed", at(9, 0, 1), symbols=1)
            raw.books(book("2330", at(9, 0, 2)))
            raw.control("stop", at(13, 36))
            raw.close()
            code = main(["--data", str(data), "--credentials", str(Path(folder) / "missing.py"),
                         "--publish", "2026-10-28"])
            self.assertEqual(code, 0)
            manifest = json.loads((data / "books" / "2026-10-28" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["counts"], {"symbols": 1, "messages": 1})
            self.assertEqual(main(["--data", str(data), "--credentials", "x", "--publish", "2026-10-28"]), 1)

    def test_a_second_recorder_exits_at_once(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder) / "market-data"
            data.mkdir()
            # This test's own process holds the lock, so it is alive.
            (data / ".books.lock").write_text(json.dumps({"pid": os.getpid(), "startedAt": "x"}), encoding="utf-8")
            code = main(["--data", str(data), "--credentials", str(Path(folder) / "missing.py")])
            self.assertEqual(code, 0)
            logs = list((data / "logs" / "books").glob("*.log"))
            self.assertEqual(len(logs), 1)
            self.assertIn("仍在執行", logs[0].read_text(encoding="utf-8"))
            self.assertFalse((data / "books-status.json").exists())


if __name__ == "__main__":
    unittest.main()
