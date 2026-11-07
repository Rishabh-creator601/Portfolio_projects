import os
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Largest difference treated as rounding, in currency units.
TOLERANCE = Decimal(os.getenv("TOLERANCE", "0.01"))


@dataclass(frozen=True)
class Settings:
    storage_dir: Path = field(default_factory=lambda: Path(os.getenv("STORAGE_DIR", "storage")))
    chat_model: str = field(default_factory=lambda: os.getenv("CHAT_MODEL", "gpt-4o-mini"))
    extract_dpi: int = 150
    reread_dpi: int = 250
    max_upload_mb: int = 20
    max_pages: int = 50

    @property
    def files_dir(self) -> Path:
        return self.storage_dir / "files"

    @property
    def db_path(self) -> Path:
        return self.storage_dir / "invoices.db"

    @property
    def checkpoint_path(self) -> Path:
        return self.storage_dir / "checkpoints.db"
