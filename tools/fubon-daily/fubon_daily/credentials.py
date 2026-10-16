"""Reads the Fubon login settings with ast; the settings file is never executed."""
from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MASK = "＊＊＊"


class CredentialsError(Exception):
    """The settings file is missing, unreadable, incomplete or kept in a disallowed place."""


@dataclass(frozen=True)
class Credentials:
    person_id: str
    api_key: str
    cert_path: str
    cert_password: str

    def secrets(self) -> list[str]:
        return [value for value in (self.person_id, self.api_key, self.cert_password) if value]


def inside_git_worktree(path: Path) -> bool:
    resolved = Path(path).resolve()
    return any((parent / ".git").exists() for parent in [resolved.parent, *resolved.parents])


def load_credentials(path: Path) -> Credentials:
    path = Path(path)
    if inside_git_worktree(path):
        raise CredentialsError("登入設定檔不可放在 Git 專案資料夾內")
    try:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise CredentialsError("找不到登入設定檔") from None
    except (OSError, SyntaxError, UnicodeDecodeError, ValueError):
        raise CredentialsError("無法讀取登入設定檔") from None
    values: dict[str, str] = {}
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            values[node.targets[0].id] = node.value.value.strip()
    key = values.get("API_KEY") or values.get("SECRET_KEY") or ""
    missing = [name for name in ("PERSON_ID", "CERT_PATH", "CERT_PASSWORD") if not values.get(name)]
    if not key:
        missing.append("API_KEY 或 SECRET_KEY")
    if missing:
        raise CredentialsError("登入設定檔缺少：" + "、".join(missing))
    if not Path(values["CERT_PATH"]).is_file():
        raise CredentialsError("找不到憑證檔，請確認 CERT_PATH")
    return Credentials(values["PERSON_ID"], key, values["CERT_PATH"], values["CERT_PASSWORD"])


class Redactor:
    """Replaces every secret (longest first) with a mask before anything is written or shown."""

    def __init__(self, secrets: Iterable[str]):
        self._secrets = sorted({secret for secret in secrets if secret}, key=len, reverse=True)

    def __call__(self, text: object) -> str:
        result = str(text)
        for secret in self._secrets:
            result = result.replace(secret, MASK)
        return result
