"""Text normalisation for business names and addresses.

Country-agnostic: the same rules (English / Indian / French conventions) are
applied to every record, so unseen country labels need no special handling.

Native-script (Indic) tokens are transliterated with a word dictionary learned
from training pairs (translit.py) and fall back to unidecode.
"""
import re

from unidecode import unidecode

# ------------------------------------------------------------------ vocab
HONORIFICS = {"sri", "shri", "shree", "smt", "dr", "mr", "mrs", "ms", "m s", "the",
              "messrs", "m/s", "mme", "mlle", "m"}

LEGAL = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp", "lp",
    "ltd", "limited", "plc", "pllc", "pc", "pvt", "private", "opc",
    "praa", "pra", "li", "lt", "prvt", "pte",  # transliterated Indic abbreviations
    "sarl", "sas", "sasu", "sa", "eurl", "sci", "snc", "scop", "selarl", "ets",
    "etablissements", "cie", "compagnie", "gmbh", "ag", "bv", "srl",
}
STOP = {"and", "of", "the", "et", "de", "du", "des", "la", "le", "les", "d", "l", "a", "an"}

# Alias markers: "X dba Y", "Y formerly X", "X nee Y", "X doing business as Y", "X aka Y"
ALIAS_RE = re.compile(
    r"\b(?:d\s*b\s*a|doing business as|formerly(?: known as)?|f k a|fka|a k a|aka|"
    r"nee|t a|trading as|anciennement|sous le nom)\b"
)

ADDR_ABBR = {
    "st": "street", "str": "street", "rd": "road", "ave": "avenue", "av": "avenue",
    "blvd": "boulevard", "bd": "boulevard", "bvd": "boulevard", "dr": "drive",
    "ln": "lane", "hwy": "highway", "pkwy": "parkway", "ct": "court", "pl": "place",
    "sq": "square", "cir": "circle", "ter": "terrace", "trl": "trail", "fl": "floor",
    "flr": "floor", "ste": "suite", "apt": "apartment", "bldg": "building",
    "n": "north", "s": "south", "e": "east", "w": "west", "ft": "fort", "mt": "mount",
    "nr": "near", "opp": "opposite", "sec": "sector", "clny": "colony", "ngr": "nagar",
    "mkt": "market", "extn": "extension", "ext": "extension", "hno": "house",
    "r": "rue", "imp": "impasse", "che": "chemin", "rte": "route", "pce": "place",
    "fbg": "faubourg", "saint": "street",
    # historic / alternate city names
    "bombay": "mumbai", "madras": "chennai", "calcutta": "kolkata", "bengaluru": "bangalore",
    "gurugram": "gurgaon", "poona": "pune", "baroda": "vadodara", "mysuru": "mysore",
    "trivandrum": "thiruvananthapuram", "cochin": "kochi", "ahmadabad": "ahmedabad",
    "benares": "varanasi", "banaras": "varanasi", "allahabad": "prayagraj",
}
# Tokens dropped from addresses (unit words / filler / null markers)
ADDR_STOP = {"no", "number", "unit", "apartment", "suite", "floor", "house", "h", "door",
             "null", "none", "na", "po", "box", "flat", "of", "the", "and", "de", "du",
             "des", "la", "le", "les", "city", "cdp", "bis", "ter", "c", "o"}

US_STATES = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa",
    "ks": "kansas", "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland",
    "ma": "massachusetts", "mi": "michigan", "mn": "minnesota", "ms": "mississippi",
    "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada",
    "nh": "new hampshire", "nj": "new jersey", "nm": "new mexico", "ny": "new york",
    "nc": "north carolina", "nd": "north dakota", "oh": "ohio", "ok": "oklahoma",
    "or": "oregon", "pa": "pennsylvania", "ri": "rhode island", "sc": "south carolina",
    "sd": "south dakota", "tn": "tennessee", "tx": "texas", "ut": "utah", "vt": "vermont",
    "va": "virginia", "wa": "washington", "wv": "west virginia", "wi": "wisconsin",
    "wy": "wyoming", "dc": "district of columbia",
}
IN_STATES = {
    "up": "uttar pradesh", "mh": "maharashtra", "dl": "delhi", "ka": "karnataka",
    "tn": "tamil nadu", "gj": "gujarat", "mp": "madhya pradesh", "rj": "rajasthan",
    "wb": "west bengal", "ap": "andhra pradesh", "ts": "telangana", "tg": "telangana",
    "kl": "kerala", "hr": "haryana", "pb": "punjab", "br": "bihar", "or": "odisha",
    "od": "odisha", "as": "assam", "jh": "jharkhand", "cg": "chhattisgarh",
    "ct": "chhattisgarh", "uk": "uttarakhand", "hp": "himachal pradesh", "ga": "goa",
    "jk": "jammu and kashmir", "ch": "chandigarh",
}
# Full state names (any country) -> removed from the "street" part of the address.
STATE_WORDS = set()
for _v in list(US_STATES.values()) + list(IN_STATES.values()):
    STATE_WORDS.update(_v.split())

_NATIVE_RE = re.compile(r"[ऀ-෿]")
_WS = re.compile(r"\s+")
_NON_ALNUM = re.compile(r"[^a-z0-9 ]+")
_NUM = re.compile(r"\d+")

# learned native-word -> latin-word dictionary (populated by translit.load)
TRANSLIT = {}


def has_native(s: str) -> bool:
    return bool(_NATIVE_RE.search(s))


def to_latin(text: str) -> str:
    """Lowercase ascii; native-script words go through the learned dictionary."""
    if not text:
        return ""
    if has_native(text):
        out = []
        for w in text.split():
            if _NATIVE_RE.search(w):
                w = TRANSLIT.get(w) or unidecode(w)
            out.append(w)
        text = " ".join(out)
    return unidecode(text).lower()


def _clean(t: str) -> str:
    return _WS.sub(" ", _NON_ALNUM.sub(" ", t)).strip()


_SKEL_SUBS = [("ph", "f"), ("ck", "k"), ("q", "k"), ("c", "k"), ("z", "s"), ("w", "v"),
              ("x", "ks"), ("tion", "shn"), ("sh", "s"), ("th", "t"), ("dh", "d"),
              ("bh", "b"), ("kh", "k"), ("gh", "g"), ("y", "")]


def skeleton(tok: str) -> str:
    """Consonant skeleton: robust to vowel typos and rough transliteration."""
    if tok.isdigit():
        return tok
    t = tok
    for a, b in _SKEL_SUBS:
        t = t.replace(a, b)
    t = re.sub(r"[aeiou]", "", t)
    t = re.sub(r"(.)\1+", r"\1", t)
    return t


# ------------------------------------------------------------------ names
def name_parts(raw: str):
    """Return (core_tokens_main, core_tokens_all, website_token).

    main: tokens of the primary name (first alias side that looks like the S1 name
    is unknown here, so we return all sides; 'all' is the union).
    """
    t = to_latin(raw)
    t = t.replace("&", " and ").replace("+", " and ").replace("@", " at ")
    web = ""
    m = re.search(r"(?:www\.)?([a-z0-9\-]+)\.(?:com|in|net|org|fr|co|biz|info)\b", t)
    if m:
        web = m.group(1).replace("-", "")
        t = t[:m.start()] + " " + web + " " + t[m.end():]
    t = t.replace("#", " ")
    t = re.sub(r"(?<=\b[a-z])\.(?=[a-z]\b)", "", t)       # l.l.c -> llc, s.a.r.l
    t = re.sub(r"(?<=\b[a-z])\.(?=[a-z]\.)", "", t)
    t = _clean(t.replace(".", " "))
    t = re.sub(r"\b([a-z]) ([a-z]) ([a-z])\b", r"\1\2\3", t)  # "l l c" -> "llc"
    sides = [s.strip() for s in ALIAS_RE.split(t) if s.strip()] or [t]
    parts = []
    for s in sides:
        toks = [w for w in s.split() if w not in LEGAL and w not in STOP and w not in HONORIFICS]
        parts.append(toks)
    return parts, web


def core_tokens(raw: str):
    parts, web = name_parts(raw)
    toks = [w for p in parts for w in p]
    return toks, parts, web


# ------------------------------------------------------------------ addresses
def addr_tokens(raw: str):
    """Returns (tokens, numbers). State abbreviations expanded; units/filler dropped."""
    t = to_latin(raw)
    t = t.replace("#", " ")
    t = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", t)
    t = _clean(re.sub(r"[/\-]", " ", t))
    t = re.sub(r"(\d)([a-z])", r"\1 \2", t)
    t = re.sub(r"([a-z])(\d)", r"\1 \2", t)
    toks, nums = [], []
    for w in t.split():
        w = ADDR_ABBR.get(w, w)
        # states carry little identity signal and appear in many surface forms
        if w in ADDR_STOP or w in STATE_WORDS or (len(w) == 2 and (w in US_STATES or w in IN_STATES)):
            continue
        if w.isdigit():
            w = w.lstrip("0") or "0"
            nums.append(w)
        toks.append(w)
    return toks, nums
