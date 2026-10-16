"""Windows toast through PowerShell's built-in WinRT API; text travels in environment variables."""
from __future__ import annotations

import os
import subprocess

TOAST = r"""
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
[void]$texts.Item(0).AppendChild($template.CreateTextNode($env:DTT_TOAST_TITLE))
[void]$texts.Item(1).AppendChild($template.CreateTextNode($env:DTT_TOAST_BODY))
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($template))
"""


def notify(title: str, body: str, runner=subprocess.run) -> bool:
    env = {**os.environ, "DTT_TOAST_TITLE": title, "DTT_TOAST_BODY": body}
    try:
        runner(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", TOAST], env=env, check=True,
               timeout=30, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return True
    except Exception:  # noqa: BLE001 - a missing toast must never fail the fetch
        return False
