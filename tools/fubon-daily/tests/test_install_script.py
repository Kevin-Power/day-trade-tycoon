import re
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "install.ps1"


class InstallScriptTest(unittest.TestCase):
    def test_scheduled_task_keeps_running_on_battery(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("-AllowStartIfOnBatteries", text)
        self.assertIn("-DontStopIfGoingOnBatteries", text)

    def test_the_middle_retry_starts_after_a_full_market_first_run(self):
        # The 16:45 run lasts 45-65 minutes, so the middle retry comes at 18:00; 19:00 stays the last attempt.
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"\$triggers = @\(([^)]*)\)", text), ["'16:45', '18:00', '19:00'"])

    def test_a_trigger_during_a_run_waits_for_it(self):
        # Dropping it (IgnoreNew) could lose the 19:00 last attempt behind a full 18:00 run; a run that starts
        # late still counts as the last attempt, since that goes by its own start time.
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"-MultipleInstances (\w+)", text), ["Queue"])


if __name__ == "__main__":
    unittest.main()
