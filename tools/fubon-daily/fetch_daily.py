"""Entry point for the scheduled task; see tools/fubon-daily/README.md."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fubon_daily.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
