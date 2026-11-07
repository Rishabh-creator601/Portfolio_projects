"""The real API with the stand-in extractor, for automated runs without an API key.

    FIXTURE_DIR=... STORAGE_DIR=... uvicorn --factory tests.fake_server:create_app
"""

import os
from pathlib import Path

from app.api.main import create_app as create_real_app
from app.config import Settings
from tests.fake_extractor import FakeExtractor


def create_app():
    return create_real_app(Settings(), FakeExtractor(Path(os.environ["FIXTURE_DIR"])))
