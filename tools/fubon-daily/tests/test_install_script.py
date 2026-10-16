import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "install.ps1"


class InstallScriptTest(unittest.TestCase):
    def test_scheduled_task_keeps_running_on_battery(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("-AllowStartIfOnBatteries", text)
        self.assertIn("-DontStopIfGoingOnBatteries", text)


if __name__ == "__main__":
    unittest.main()
