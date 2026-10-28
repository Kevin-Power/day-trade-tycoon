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

    def test_the_books_task_starts_at_0840_and_again_every_10_minutes_until_1320(self):
        # The later triggers restart a recorder that crashed within 10 minutes; Windows ignores them while one is
        # running, and a finished day exits at once. Whether a non-zero exit restarts a task is not reliable.
        text = block("BooksTask")
        self.assertIn("$booksTimes = 0..28 | ForEach-Object { ([datetime]'08:40').AddMinutes(10 * $_).ToString('HH:mm') }",
                      text)
        self.assertIn("$booksTriggers = $booksTimes | ForEach-Object { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $_ }",
                      text)

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

    def test_the_books_task_can_record_without_publishing(self):
        self.assertIn("[switch]$BooksNoPublish", SCRIPT.read_text(encoding="utf-8-sig"))
        self.assertIn("if ($BooksNoPublish) { $arguments += ' --no-publish' }", block("BooksTask"))

    def test_app_install_copies_record_books(self):
        self.assertIn("'record_books.py'", block("App"))

    def test_the_sdk_install_pins_google_auth_and_requests_before_the_freeze(self):
        # google-auth reads the sheet; requests is only an extra of google-auth, so it is pinned on its own.
        text = block("Sdk")
        self.assertIn("pip install --disable-pip-version-check google-auth==2.62.0 requests==2.34.2", text)
        self.assertLess(text.index("google-auth==2.62.0"), text.index("pip freeze"))
        self.assertIn("if ($LASTEXITCODE)", text[text.index("google-auth==2.62.0"):text.index("pip freeze")])

    def test_the_pinned_google_auth_is_the_one_the_tests_run_against(self):
        # tests/test_radar.py runs in a venv built from this pin (see the README, Tests).
        self.assertIn("google-auth==2.62.0", (SCRIPT.parent / "README.md").read_text(encoding="utf-8"))

    def test_radar_sheet_is_a_parameter_that_writes_the_local_config(self):
        text = SCRIPT.read_text(encoding="utf-8-sig")
        self.assertIn("[string]$RadarSheet", text)
        body = block("RadarSheet")
        self.assertIn("-notmatch '^[A-Za-z0-9_-]+$'", body)  # the id is checked before it goes anywhere
        self.assertIn("Join-Path $env:USERPROFILE '.daytrade-tycoon'", body)
        self.assertIn("New-Item -ItemType Directory -Force -Path $radarFolder", body)
        self.assertIn("'radar.local.json'", body)
        self.assertIn("sheetId = $RadarSheet", body)
        self.assertIn("keyFile = 'google-radar-reader.json'", body)
        codes = re.search(r"\[char\[\]\]\(([^)]*)\)", body)
        self.assertIsNotNone(codes)
        self.assertEqual("".join(chr(int(code, 16)) for code in re.findall(r"0x[0-9A-Fa-f]+", codes.group(1))),
                         "定格名單")
        self.assertIn("tab = $radarTab", body)

    def test_the_radar_config_is_written_as_utf8_without_a_bom(self):
        # Set-Content / Out-File -Encoding UTF8 would put a BOM in front of the JSON.
        body = block("RadarSheet")
        self.assertIn("[IO.File]::WriteAllText(", body)
        self.assertIn("(New-Object System.Text.UTF8Encoding($false))", body)
        for command in ("Set-Content", "Out-File", "Add-Content", " > "):
            self.assertNotIn(command, body)

    def test_the_radar_setup_never_touches_the_key_file(self):
        # The key file's name goes into the config and a missing file is only noted (Test-Path): nothing reads,
        # copies, moves, deletes or writes it.
        body = block("RadarSheet")
        for command in ("Get-Content", "Copy-Item", "Move-Item", "Remove-Item", "Rename-Item", "Set-Acl", "icacls"):
            self.assertNotIn(command, body)
        self.assertEqual(body.count("WriteAllText"), 1)

    def test_a_radar_sheet_alone_is_a_complete_request(self):
        self.assertIn("$RadarSheet", re.search(r"^if \(-not \(.*\)\) \{ Write-Output.*$",
                                               SCRIPT.read_text(encoding="utf-8-sig"), re.M).group(0))

    def test_the_script_stays_plain_ascii(self):
        # It has no byte order mark, and Windows PowerShell 5.1 reads such a file in the system's ANSI code page:
        # the tab name is therefore built from code points, not written out.
        data = SCRIPT.read_bytes()
        self.assertFalse(data.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(data.isascii())


if __name__ == "__main__":
    unittest.main()
