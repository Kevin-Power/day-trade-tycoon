# Packs one frozen delivery into output/drive-upload/:
#   當沖大富翁-學員實戰闖關手冊-<version>.pdf, 當沖大富翁-講師版教學手冊-<version>.pdf (copies, times kept)
#   當沖大富翁-數位互動版-<version>.zip (output/web, index.html at the top)
# Deliverables of other versions are moved into 舊版-<their version>/ first (never overwritten or deleted).
# The finished ZIP is then checked member by member on the names as stored in the archive
# (ZipInfo.orig_filename: Python on Windows turns "\" into "/" in .filename, so that one cannot be trusted):
# every name must use "/", with no backslash, no absolute path or drive letter and no ".." segment, and the
# members must be exactly the files of output/web. Any violation removes the ZIP and exits 1.
#   python courseware/academy/build/package.py <version>
#   python courseware/academy/build/package.py --check <zip>     (only checks an existing ZIP's member names)
# Writes output/qa/package.json.
import json
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

ACADEMY = Path(__file__).resolve().parent.parent
OUT = ACADEMY / "output"
UPLOAD = OUT / "drive-upload"
NAMES = {
    "student": ("當沖大富翁-學員實戰闖關手冊.pdf", "當沖大富翁-學員實戰闖關手冊-{v}.pdf"),
    "teacher": ("當沖大富翁-講師版教學手冊.pdf", "當沖大富翁-講師版教學手冊-{v}.pdf"),
}
ZIP_NAME = "當沖大富翁-數位互動版-{v}.zip"
DELIVERABLE = re.compile(r"^當沖大富翁-(學員實戰闖關手冊|講師版教學手冊|數位互動版)-(?P<v>\d{4}\.\d{2}(?:-r[\d.]+)?)\.(pdf|zip)$")


def member_problems(name):
    problems = []
    if not name:
        problems.append("空白名稱")
    if "\\" in name:
        problems.append("含反斜線")
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        problems.append("絕對路徑")
    if any(part == ".." for part in name.split("/")):
        problems.append("含 ..")
    if "\x00" in name:
        problems.append("含 NUL")
    return problems


def check_only(path):
    with zipfile.ZipFile(path) as archive:
        stored = [info.orig_filename for info in archive.infolist()]
    bad = [(name, member_problems(name)) for name in stored if member_problems(name)]
    print(f"{Path(path).name}: {len(stored)} members, {len(bad)} with bad names")
    for name, problems in bad[:10]:
        print(f"  {name}: {', '.join(problems)}")
    sys.exit(1 if bad else 0)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) == 3 and sys.argv[1] == "--check":
        return check_only(sys.argv[2])
    if len(sys.argv) != 2:
        sys.exit("usage: python package.py <version> | --check <zip>")
    version = sys.argv[1]
    UPLOAD.mkdir(parents=True, exist_ok=True)

    # 1. Older deliverables go to 舊版-<version>/ (refuse to overwrite anything already there).
    moved = []
    for path in sorted(UPLOAD.iterdir()):
        match = DELIVERABLE.match(path.name)
        if not path.is_file() or not match or match.group("v") == version:
            continue
        target = UPLOAD / f"舊版-{match.group('v')}" / path.name
        if target.exists():
            sys.exit(f"stop: {target} already exists; nothing was moved over it")
        target.parent.mkdir(exist_ok=True)
        shutil.move(str(path), str(target))
        moved.append(f"{path.name} → {target.parent.name}/")

    # 2. The two PDFs (copy2 keeps the build time).
    for source_name, target_name in NAMES.values():
        source = OUT / source_name
        if not source.is_file():
            sys.exit(f"stop: {source} is missing; run build.mjs first")
        shutil.copy2(source, UPLOAD / target_name.format(v=version))

    # 3. The digital edition: posix member names relative to output/web, in a stable order.
    web = OUT / "web"
    files = sorted(path.relative_to(web).as_posix() for path in web.rglob("*") if path.is_file())
    if "index.html" not in files:
        sys.exit("stop: output/web/index.html is missing; run build.mjs first")
    target = UPLOAD / ZIP_NAME.format(v=version)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in files:
            archive.write(web / name, name)

    # 4. Check the finished ZIP as stored.
    with zipfile.ZipFile(target) as archive:
        stored = [info.orig_filename for info in archive.infolist()]
        broken = archive.testzip()
    errors = [f"{name}: {', '.join(member_problems(name))}" for name in stored if member_problems(name)]
    if sorted(stored) != files:
        missing = sorted(set(files) - set(stored))
        extra = sorted(set(stored) - set(files))
        errors.append(f"成員與 output/web 不一致（少 {missing[:5]}、多 {extra[:5]}）")
    if broken:
        errors.append(f"CRC 錯誤：{broken}")
    for required in ("index.html", "assets/web.css", "assets/web.js"):
        if required not in stored:
            errors.append(f"缺少 {required}")
    report = {
        "version": version,
        "zip": target.name,
        "members": len(stored),
        "backslashMembers": sum("\\" in name for name in stored),
        "absoluteMembers": sum(name.startswith("/") or bool(re.match(r"^[A-Za-z]:", name)) for name in stored),
        "dotDotMembers": sum(any(part == ".." for part in name.split("/")) for name in stored),
        "fonts": sum(name.startswith("assets/fonts/") for name in stored),
        "images": sum(name.startswith("assets/shots/") for name in stored),
        "moved": moved,
        "ok": not errors,
        "errors": errors,
    }
    (OUT / "qa").mkdir(parents=True, exist_ok=True)
    (OUT / "qa" / "package.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if errors:
        target.unlink()
        print("PACKAGE CHECK FAILED — the ZIP was removed:")
        for line in errors:
            print("  " + line)
        sys.exit(1)
    print(f"packaged {version}: 2 PDFs, {target.name} with {len(stored)} members (all '/' names, no absolute or '..' paths)")
    for line in moved:
        print("  moved " + line)


if __name__ == "__main__":
    main()
