"""Configuration and key loading.

These exist because the failure they guard against is silent: with no API key
the service starts cleanly, reports itself healthy, and falls back to its
defaults. The integration then looks finished while only ever having worked
from inline shell variables. A test is the only thing that notices.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SERVICE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = SERVICE_DIR.parent


def _reload_config(monkeypatch, *, load_env_file=False, **env):
    """Reload app.config with a controlled environment.

    ``load_env_file`` is off by default: reloading the module re-runs
    load_dotenv, which would repopulate the very variables the test just
    cleared, and a test that reads the developer's own .env proves nothing.
    """
    if not load_env_file:
        import dotenv

        monkeypatch.setattr(dotenv, "load_dotenv", lambda *a, **k: False)

    for key in (
        "VLM_API_KEY",
        # The backup slots must be cleared too: an earlier test that loaded the
        # real .env leaves them in os.environ for the rest of the session, and a
        # key surviving into a "no key configured" test makes it pass wrongly.
        "VLM_API_KEY_2",
        "VLM_API_KEY_3",
        "VLM_API_KEYS",
        "VLM_PROVIDER",
        "VLM_MODEL",
        "VLM_ENABLED",
        "EXTRACTION_MODE",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
    ):
        monkeypatch.delenv(key, raising=False)

    for key, value in env.items():
        monkeypatch.setenv(key, value)

    import app.config

    return importlib.reload(app.config)


class TestEnvFileLoading:
    def test_dotenv_is_loaded_at_import(self, monkeypatch):
        """A key in .env must reach the service without any manual export.

        This is the regression that mattered: the service read os.environ
        directly and never loaded .env, so the key sat in the file unused.
        """
        env_file = PROJECT_ROOT / ".env"
        if not env_file.is_file():
            pytest.skip("No project .env in this checkout")

        contents = env_file.read_text(encoding="utf-8", errors="replace")
        if "VLM_API_KEY=" not in contents:
            pytest.skip("No VLM_API_KEY configured in .env")

        configured = [
            line for line in contents.splitlines() if line.startswith("VLM_API_KEY=") and len(line) > len("VLM_API_KEY=")
        ]
        if not configured:
            pytest.skip("VLM_API_KEY is present but empty")

        config = _reload_config(monkeypatch, load_env_file=True)
        assert config.settings.VLM_API_KEY, "VLM_API_KEY in .env did not reach the service"

    def test_real_environment_wins_over_the_file(self, monkeypatch):
        """Docker and CI pass variables directly; those must not be overridden."""
        config = _reload_config(
            monkeypatch, load_env_file=True, VLM_API_KEY="from-the-environment"
        )
        assert config.settings.VLM_API_KEY == "from-the-environment"


class TestProviderResolution:
    def test_generic_key_is_preferred(self, monkeypatch):
        config = _reload_config(
            monkeypatch, VLM_API_KEY="generic", ANTHROPIC_API_KEY="anthropic-specific"
        )
        assert config.settings.VLM_API_KEY == "generic"

    @pytest.mark.parametrize(
        "variable", ["ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"]
    )
    def test_falls_back_to_each_provider_variable(self, monkeypatch, variable):
        """An existing environment keeps working without being rewritten."""
        config = _reload_config(monkeypatch, **{variable: "provider-key"})
        assert config.settings.VLM_API_KEY == "provider-key"

    @pytest.mark.parametrize(
        "provider,expected_model",
        [
            ("google", "gemini-2.5-flash"),
            ("anthropic", "claude-sonnet-5"),
            ("openai", "gpt-4o"),
        ],
    )
    def test_default_model_follows_the_provider(self, monkeypatch, provider, expected_model):
        config = _reload_config(monkeypatch, VLM_PROVIDER=provider)
        assert config.settings.VLM_MODEL == expected_model

    def test_explicit_model_overrides_the_default(self, monkeypatch):
        config = _reload_config(monkeypatch, VLM_PROVIDER="google", VLM_MODEL="gemini-2.5-pro")
        assert config.settings.VLM_MODEL == "gemini-2.5-pro"


class TestKeyFailover:
    def test_collects_every_configured_key_in_order(self, monkeypatch):
        config = _reload_config(
            monkeypatch, VLM_API_KEY="primary", VLM_API_KEY_2="backup", VLM_API_KEY_3="third"
        )
        assert config.settings.VLM_API_KEYS == ["primary", "backup", "third"]

    def test_accepts_a_comma_separated_list(self, monkeypatch):
        config = _reload_config(monkeypatch, VLM_API_KEY="primary", VLM_API_KEYS="a, b ,c")
        assert config.settings.VLM_API_KEYS == ["primary", "a", "b", "c"]

    def test_drops_blank_slots(self, monkeypatch):
        config = _reload_config(monkeypatch, VLM_API_KEY="primary", VLM_API_KEY_2="  ")
        assert config.settings.VLM_API_KEYS == ["primary"]

    def test_configured_on_a_backup_key_alone(self, monkeypatch):
        # A revoked primary must not make the service report itself unconfigured.
        _reload_config(monkeypatch, VLM_PROVIDER="google", VLM_API_KEY_2="backup")

        import app.gemini.extractor as extractor

        importlib.reload(extractor)
        assert extractor.is_configured() is True


class TestExtractionMode:
    def test_defaults_to_gemini(self, monkeypatch):
        config = _reload_config(monkeypatch)
        assert config.settings.EXTRACTION_MODE == "gemini"

    def test_legacy_mode_can_be_restored(self, monkeypatch):
        config = _reload_config(monkeypatch, EXTRACTION_MODE="legacy")
        assert config.settings.EXTRACTION_MODE == "legacy"


class TestGeminiReadiness:
    def test_reports_unconfigured_without_a_key(self, monkeypatch):
        _reload_config(monkeypatch, VLM_PROVIDER="google")

        import app.gemini.extractor as extractor

        importlib.reload(extractor)
        assert extractor.is_configured() is False

    def test_reports_configured_with_a_google_key(self, monkeypatch):
        _reload_config(monkeypatch, VLM_PROVIDER="google", VLM_API_KEY="a-key")

        import app.gemini.extractor as extractor

        importlib.reload(extractor)
        assert extractor.is_configured() is True

    def test_a_key_for_another_provider_is_not_treated_as_gemini(self, monkeypatch):
        _reload_config(monkeypatch, VLM_PROVIDER="anthropic", VLM_API_KEY="sk-ant-something")

        import app.gemini.extractor as extractor

        importlib.reload(extractor)
        assert extractor.is_configured() is False

    def test_missing_key_raises_a_message_that_says_what_to_do(self, monkeypatch):
        _reload_config(monkeypatch, VLM_PROVIDER="google")

        import app.gemini.extractor as extractor

        importlib.reload(extractor)
        with pytest.raises(extractor.GeminiUnavailable, match=r"\.env"):
            extractor.extract(b"not-an-image")


class TestSecretHygiene:
    def test_no_api_key_is_hard_coded_in_source(self):
        """A key committed once stays in git history after it is deleted."""
        suspicious = []

        for path in SERVICE_DIR.rglob("*.py"):
            if "__pycache__" in path.parts or path.name == "test_config.py":
                continue

            for number, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                # Prefixes used by the providers this service talks to.
                if any(marker in line for marker in ("AQ.Ab8", "sk-ant-", "AIzaSy", "sk-proj-")):
                    suspicious.append(f"{path.relative_to(SERVICE_DIR)}:{number}")

        assert not suspicious, f"Possible hard-coded API key in: {', '.join(suspicious)}"
