"""GSTIN structure and checksum rules.

A GSTIN has 15 characters: 2-digit state code, 10-character PAN, entity code,
the letter Z, and a base-36 check character.
"""

import re

_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_FORMAT = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

# Codes 01-38 are states and union territories. 97 is "Other Territory" and
# 99 is the Centre Jurisdiction. Code 28 is the pre-2014 Andhra Pradesh code,
# still valid on older registrations.
_STATE_CODES = {f"{n:02d}" for n in range(1, 39)} | {"97", "99"}


STATE_NAMES = {
    "jammu and kashmir": "01", "himachal pradesh": "02", "punjab": "03", "chandigarh": "04", "uttarakhand": "05",
    "haryana": "06", "delhi": "07", "rajasthan": "08", "uttar pradesh": "09", "bihar": "10", "sikkim": "11",
    "arunachal pradesh": "12", "nagaland": "13", "manipur": "14", "mizoram": "15", "tripura": "16",
    "meghalaya": "17", "assam": "18", "west bengal": "19", "jharkhand": "20", "odisha": "21", "chhattisgarh": "22",
    "madhya pradesh": "23", "gujarat": "24", "dadra and nagar haveli and daman and diu": "26", "maharashtra": "27",
    "karnataka": "29", "goa": "30", "lakshadweep": "31", "kerala": "32", "tamil nadu": "33", "puducherry": "34",
    "andaman and nicobar islands": "35", "telangana": "36", "andhra pradesh": "37", "ladakh": "38",
}


def checksum(first_14: str) -> str:
    """Return the check character for the first 14 characters of a GSTIN."""
    total = 0
    for position, char in enumerate(first_14):
        factor = 2 if position % 2 else 1
        quotient, remainder = divmod(_CHARSET.index(char) * factor, 36)
        total += quotient + remainder
    return _CHARSET[(36 - total % 36) % 36]


def has_valid_format(gstin: str) -> bool:
    """True if the layout and state code are right. The check character is not tested."""
    return bool(_FORMAT.match(gstin)) and gstin[:2] in _STATE_CODES


def has_valid_checksum(gstin: str) -> bool:
    """True if a correctly formatted GSTIN also has the right check character."""
    return has_valid_format(gstin) and checksum(gstin[:14]) == gstin[14]


def state_code(gstin: str) -> str:
    return gstin[:2]
