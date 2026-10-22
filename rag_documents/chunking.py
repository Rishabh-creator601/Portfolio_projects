import re
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from config import CHUNK_SIZE, CHUNK_OVERLAP


splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)

# common research-paper headings, e.g. "Abstract", "3 Method", "4.1 Datasets", "V. RESULTS"
SECTION_WORDS = ("abstract", "introduction", "background", "related work", "preliminar",
                 "method", "approach", "model", "experiment", "dataset", "data",
                 "result", "evaluation", "analysis", "discussion", "limitation",
                 "conclusion", "future work", "acknowledg", "reference", "bibliography", "appendix")
# headings without a number must be one of these exact names (avoids table headers like "Model NQ TQA")
PLAIN_HEADINGS = {"abstract", "introduction", "background", "related work", "method", "methods",
                  "methodology", "approach", "experiments", "results", "evaluation", "discussion",
                  "limitations", "conclusion", "conclusions", "future work", "acknowledgments",
                  "acknowledgements", "references", "bibliography", "appendix"}
HEADING = re.compile(r"^(\d+(?:\.\d+)*\.?|[IVX]+\.)?\s*([A-Za-z][A-Za-z &\-]{2,50})$")
SKIP_SECTIONS = ("reference", "bibliography", "acknowledg")


def find_heading(line):
    match = HEADING.match(line.strip())
    if not match:
        return None
    number, name = match.group(1), match.group(2).strip()
    if number and len(name.split()) <= 6 and name.lower().startswith(SECTION_WORDS):
        return name.title()
    if not number and name.lower() in PLAIN_HEADINGS:
        return name.title()
    return None


def recursive_chunks(pages):
    chunks = splitter.split_documents(pages)
    for c in chunks:
        c.metadata["section"] = ""
    return chunks


def section_aware_chunks(pages):
    # walk the pages line by line, start a new block at every heading,
    # then split each block so a chunk never mixes two sections or two pages
    chunks, section = [], "Front matter"

    for page in pages:
        blocks, lines = [], []
        for line in page.page_content.splitlines():
            heading = find_heading(line)
            if heading:
                blocks.append((section, lines))
                section, lines = heading, []
            lines.append(line)
        blocks.append((section, lines))

        for sec, lines in blocks:
            text = "\n".join(lines).strip()
            if not text or sec.lower().startswith(SKIP_SECTIONS):
                continue
            for piece in splitter.split_text(text):
                meta = {**page.metadata, "section": sec}
                chunks.append(Document(page_content=piece, metadata=meta))
    return chunks


CHUNKERS = {"section_aware": section_aware_chunks, "recursive": recursive_chunks}


def make_chunks(pages, method="section_aware"):
    return CHUNKERS[method](pages)


def body_text(pages):
    # full text without the reference list, used for the per-paper summary
    text = "\n".join(p.page_content for p in pages)
    lines = text.splitlines()
    for i in range(len(lines) - 1, -1, -1):
        heading = find_heading(lines[i])
        if heading and heading.lower().startswith(("reference", "bibliography")):
            return "\n".join(lines[:i])
    return text
