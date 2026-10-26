import re
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "install.ps1"


def block(name: str) -> str:
    """The body of `if ($<name>) { ... }` at the top level of install.ps1."""
    text = SCRIPT.read_text(encoding="utf-8-sig")
    found = re.search(r"^if \(\$" + name + r"\) \{\n(.*?)^\}", text, re.S | re.M)
    assert found, f"no -{name} block"
    return found.group(1)


class InstallScriptTest(unittest.TestCase):
    def test_scheduled_task_keeps_running_on_battery(self):
        for name in ("Task", "BooksTask"):
            with self.subTest(name=name):
                text = block(name)
                self.assertIn("-AllowStartIfOnBatteries", text)
                self.assertIn("-DontStopIfGoingOnBatteries", text)

    def test_the_middle_retry_starts_after_a_full_market_first_run(self):
        # The 16:45 run lasts 45-65 minutes, so the middle retry comes at 18:00; 19:00 stays the last attempt.
        self.assertEqual(re.findall(r"\$triggers = @\(([^)]*)\)", block("Task")), ["'16:45', '18:00', '19:00'"])

    def test_a_trigger_during_a_run_waits_for_it(self):
        # Dropping it (IgnoreNew) could lose the 19:00 last attempt behind a full 18:00 run; a run that starts
        # late still counts as the last attempt, since that goes by its own start time.
        self.assertEqual(re.findall(r"-MultipleInstances (\w+)", block("Task")), ["Queue"])

    def test_the_books_task_starts_at_0840_with_restart_triggers(self):
        # The later triggers restart a recorder that crashed; Windows ignores them while one is running.
        self.assertEqual(re.findall(r"\$booksTriggers = @\(([^)]*)\)", block("BooksTask")),
                         ["'08:40', '09:30', '10:30', '11:30', '12:30'"])

    def test_the_books_task_ignores_a_second_start_and_restarts_on_failure(self):
        text = block("BooksTask")
        self.assertEqual(re.findall(r"-MultipleInstances (\w+)", text), ["IgnoreNew"])
        self.assertIn("-RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)", text)
        self.assertIn("-ExecutionTimeLimit (New-TimeSpan -Hours 6)", text)
        self.assertIn("-StartWhenAvailable", text)
        self.assertIn("'DayTradeTycoonBooks'", text)
        self.assertIn("record_books.py", text)
        self.assertIn("work-books", text)
        self.assertIn("-LogonType Interactive -RunLevel Limited", text)

    def test_app_install_copies_record_books(self):
        self.assertIn("'record_books.py'", block("App"))


if __name__ == "__main__":
    unittest.main()
