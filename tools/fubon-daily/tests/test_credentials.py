import tempfile
import unittest
from pathlib import Path

from fubon_daily.credentials import CredentialsError, Redactor, load_credentials


class CredentialsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        self.cert = self.dir / "A123456789.pfx"
        self.cert.write_bytes(b"cert")

    def tearDown(self):
        self.temp.cleanup()

    def settings(self, **values):
        base = {
            "PERSON_ID": "A123456789",
            "API_KEY": "",
            "SECRET_KEY": "SECRETKEY123",
            "CERT_PATH": str(self.cert),
            "CERT_PASSWORD": "CERTPASS999",
        }
        base.update(values)
        path = self.dir / "credentials.local.py"
        path.write_text("".join(f"{key} = {value!r}\n" for key, value in base.items()), encoding="utf-8")
        return path

    def test_reads_strings_without_running_the_file(self):
        path = self.settings()
        path.write_text(path.read_text(encoding="utf-8") + "raise SystemExit('executed')\n", encoding="utf-8")
        credentials = load_credentials(path)
        self.assertEqual(
            (credentials.person_id, credentials.api_key, credentials.cert_password),
            ("A123456789", "SECRETKEY123", "CERTPASS999"),
        )

    def test_api_key_is_preferred_over_secret_key(self):
        self.assertEqual(load_credentials(self.settings(API_KEY="APIKEY1")).api_key, "APIKEY1")

    def test_missing_fields_are_named(self):
        with self.assertRaises(CredentialsError) as caught:
            load_credentials(self.settings(SECRET_KEY="", CERT_PASSWORD=""))
        self.assertIn("CERT_PASSWORD", str(caught.exception))
        self.assertIn("API_KEY", str(caught.exception))

    def test_missing_certificate_file_is_refused(self):
        with self.assertRaises(CredentialsError):
            load_credentials(self.settings(CERT_PATH=str(self.dir / "missing.pfx")))

    def test_settings_inside_a_git_worktree_are_refused(self):
        path = self.settings()
        (self.dir / ".git").mkdir()
        with self.assertRaises(CredentialsError) as caught:
            load_credentials(path)
        self.assertIn("Git", str(caught.exception))

    def test_unreadable_or_missing_files_are_credentials_errors(self):
        broken = self.dir / "credentials.local.py"
        broken.write_text("PERSON_ID = (\n", encoding="utf-8")
        with self.assertRaises(CredentialsError):
            load_credentials(broken)
        with self.assertRaises(CredentialsError):
            load_credentials(self.dir / "none.py")

    def test_redactor_hides_every_secret_even_inside_paths(self):
        credentials = load_credentials(self.settings())
        redact = Redactor(credentials.secrets())
        text = redact("login A123456789 key SECRETKEY123 cert CERTPASS999 path C:/x/A123456789.pfx")
        for secret in ("A123456789", "SECRETKEY123", "CERTPASS999"):
            self.assertNotIn(secret, text)
        self.assertIn("＊＊＊", text)
