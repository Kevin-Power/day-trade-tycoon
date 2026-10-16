import unittest

from fubon_daily.notify import notify


class NotifyTest(unittest.TestCase):
    def test_text_travels_in_the_environment_not_the_command_line(self):
        calls = []
        self.assertTrue(notify("標題", "內容 <b>&", runner=lambda args, **kw: calls.append((args, kw))))
        args, kwargs = calls[0]
        self.assertEqual(args[0], "powershell.exe")
        self.assertNotIn("內容", " ".join(args))
        self.assertEqual(kwargs["env"]["DTT_TOAST_TITLE"], "標題")
        self.assertEqual(kwargs["env"]["DTT_TOAST_BODY"], "內容 <b>&")

    def test_failures_return_false(self):
        def broken(args, **kwargs):
            raise OSError("no powershell")

        self.assertFalse(notify("t", "b", runner=broken))


if __name__ == "__main__":
    unittest.main()
