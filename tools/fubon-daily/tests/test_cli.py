import unittest
from datetime import date, timedelta

from fubon_daily.cli import parse_args


class CliTest(unittest.TestCase):
    def test_required_paths_and_defaults(self):
        args = parse_args(["--data", "md", "--credentials", "c.py"])
        self.assertEqual((args.data.name, args.date, args.symbols, args.last_attempt), ("md", None, None, False))

    def test_symbols_need_a_date(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--symbols", "2330"])

    def test_dates_must_be_valid_and_not_in_the_future(self):
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", "2026-13-01"])
        future = (date.today() + timedelta(days=2)).isoformat()
        with self.assertRaises(SystemExit):
            parse_args(["--data", "d", "--credentials", "c", "--date", future])

    def test_symbols_are_split_and_trimmed(self):
        args = parse_args(["--data", "d", "--credentials", "c", "--date", "2026-10-05", "--symbols", "2330, 2317"])
        self.assertEqual(args.symbols, ["2330", "2317"])


if __name__ == "__main__":
    unittest.main()
