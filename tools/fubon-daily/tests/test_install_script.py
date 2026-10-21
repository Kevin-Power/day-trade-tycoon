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
        # The 16:45 run lasts 45-65 minutes and Windows drops a trigger while it runs (IgnoreNew),
        # so the middle retry comes at 18:00; 19:00 stays the last attempt (18:50 or later).
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(re.findall(r"\$triggers = @\(([^)]*)\)", text), ["'16:45', '18:00', '19:00'"])
        self.assertIn("-MultipleInstances IgnoreNew", text)


if __name__ == "__main__":
    unittest.main()
