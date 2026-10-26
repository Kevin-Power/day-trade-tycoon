"""Entry point for the DayTradeTycoonBooks task (today's real 五檔); see tools/fubon-daily/README.md."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fubon_daily.books_cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
