import json
import os
import tempfile
import unittest
from datetime import time
from pathlib import Path

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
