import pytest

from tests.fixtures.generate import generate


@pytest.fixture(scope="session")
def fixture_set(tmp_path_factory):
    """Generate the invoice set once per test run. Returns (output folder, answers)."""
    out = tmp_path_factory.mktemp("invoices")
    return out, generate(out)
