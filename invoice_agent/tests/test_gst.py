import pytest

from app.gst import checksum, has_valid_checksum, has_valid_format, state_code


# Checksum-valid GSTINs from outside this project, including the sample in the GST
# portal's own validator code (09AAAUP8175A1ZG) and one whose check character is a letter.
@pytest.mark.parametrize("gstin", ["09AAAUP8175A1ZG", "27AAPFU0939F1ZV", "27AAACR5055K1Z7", "29AAACI1195H1ZI"])
def test_published_examples_pass(gstin):
    assert has_valid_format(gstin)
    assert has_valid_checksum(gstin)
    assert checksum(gstin[:14]) == gstin[14]


@pytest.mark.parametrize("gstin", [
    "27AAPFU0939F1Z",       # too short
    "27AAPFU0939F1ZVX",     # too long
    "27aapfu0939f1zv",      # lower case
    "2AAAPFU0939F1ZV",      # state code not numeric
    "27AAPFU0939F1YV",      # 14th character must be Z
    "27AAPFU0939F0ZV",      # entity code cannot be 0
    "00AAPFU0939F1ZV",      # no such state
    "",
])
def test_bad_format_rejected(gstin):
    assert not has_valid_format(gstin)
    assert not has_valid_checksum(gstin)


# 29GGGGG1314R9Z6 is a widely copied format example, but its check character is wrong.
@pytest.mark.parametrize("gstin", ["27AAPFU0939F1ZA", "29GGGGG1314R9Z6"])
def test_wrong_check_character_keeps_format_but_fails_checksum(gstin):
    assert has_valid_format(gstin)
    assert not has_valid_checksum(gstin)


def test_state_code():
    assert state_code("29AAACI1195H1ZI") == "29"
