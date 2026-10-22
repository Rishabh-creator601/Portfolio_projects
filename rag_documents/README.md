# 📚 Research Paper Assistant (RAG)

Upload research papers (PDF or Word), ask questions across all of them with **page-level citations**,
get a structured summary of each paper and compare papers side by side.

Built with **LangChain · OpenAI (gpt-4o-mini + text-embedding-3-small) · Chroma · BM25 · Streamlit**.

## Features

| Tab | What it does |
|---|---|
| 📁 Library | Upload many PDF / DOCX files. Each one is chunked, embedded and auto-summarized. |
| 💬 Ask | Questions across all papers (or only selected ones). Answers cite `[paper, p. N]`, and the source passages are shown. |
| 📝 Summaries | Per paper: title, problem, method, dataset, results, limitations. |
| ⚖️ Compare | Side-by-side table of the summaries (no extra API cost). |
| ℹ️ About | Flowchart of the whole app, pipeline steps, tech stack and current settings. |

## Pipeline config

Defaults are in `config.py`, and every option can be switched from the sidebar:

```python
config = {
    "chunking": "section_aware",   # or "recursive"
    "retriever": "hybrid",         # or "similarity"
    "prompt": "research",          # or "general"
    "collection": "client_xyz",    # one Chroma collection per client (set here, not in the UI)
}
```

- **section_aware**: detects headings (Abstract, Introduction, Method, Results ...), keeps each chunk inside one section and page, and skips the reference list.
- **hybrid**: BM25 keyword search + vector search merged with reciprocal rank fusion. Good for exact terms like dataset names and metrics.
- **Loader** is picked automatically from the file type: PDF uses PyMuPDF (fast, keeps two-column reading order), DOCX uses python-docx.
- **DOCX**: Word files have no fixed pages, so citations point to the nearest heading.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then put your OpenAI key in .env
streamlit run app.py
```

## Project structure

```
app.py               Streamlit entry: sidebar config + tabs
config.py            pipeline config and model names
loaders.py           PDF (PyMuPDF) / DOCX -> pages with {paper, page, loc}
chunking.py          section_aware / recursive chunking
retriever.py         Chroma store, similarity / hybrid search
prompts.py           Q&A and summary prompts
model.py             ask(), summarize()
page_templates/      one show() per tab
sample_papers/       3 open-access arXiv papers for a demo (RAG, DPR, REALM)
storage/             Chroma DB + saved summaries (created on first run)
```

## Limitations (v1)

- Scanned / image-only pages are skipped with a warning (no OCR yet).
- Figures and charts are not read. Their captions are, because they are text.
- Planned next: `"images": "vision"` so GPT describes figures and scanned pages.
