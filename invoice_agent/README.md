# Invoice Agent

Reads PDF and scanned invoices, checks the totals and GST details, flags errors, and exports to Excel.
Built with LangGraph, FastAPI and Streamlit, and packaged with Docker.

## Key design rule

The LLM only reads the invoice, and plain Python does all the checks. Extracted values stay as printed
strings until they are parsed into `Decimal`, so the model has no chance to quietly correct a wrong total.

## How it works

Each upload runs through a LangGraph pipeline:

```
ingest -> classify_pages -> extract -> normalize -> validate -> persist
                                          ^            |
                                          |            +-> reread -------+  (first math error only)
                                          |            |                 |
                                          +------------+-> human_review  |
                                          +------------------------------+
```

- **classify_pages** sends pages with a text layer to the model as text and image-only pages as images.
- **validate** checks line amounts, subtotal, tax, total and balance due, GSTIN format and checksum,
  CGST+SGST vs IGST against the place of supply, required fields, dates, negative amounts and duplicates.
- **reread** runs on the first math error. It reads the pages again as higher-resolution images. If the
  values change, the first read was probably wrong. If they match, the error is probably real.
- **human_review** pauses the graph with `interrupt()`. A reviewer approves the flags or submits a
  correction, which is checked again. Paused reviews are saved to SQLite and survive a restart.

## Setup

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env      # then add your OPENAI_API_KEY
pytest
```

## Running

Locally, in two terminals:

```
uvicorn --factory app.api.main:create_app --port 8000
streamlit run ui/app.py
```

With Docker:

```
docker compose up --build
```

The UI runs at http://localhost:8501 and the API at http://localhost:8000. Uploaded files and the
database are stored in `storage/` when run locally, or in the `invoice-data` volume when run with Docker.

### API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Health check |
| POST | `/invoices` | Upload one or more PDF, PNG or JPG files |
| GET | `/invoices?status=` | List invoices (`processing`, `needs_review`, `approved`, `failed`) |
| GET | `/invoices/{id}` | Extracted fields, flags and status |
| GET | `/invoices/{id}/pages/{n}` | A page as a PNG |
| POST | `/invoices/{id}/review` | `{"action": "approve"}` or `{"action": "correct", "invoice": {...}}` |
| GET | `/exports/invoices.xlsx` | Workbook with Invoices, Line Items and Issues sheets |

## Testing

```
pytest                              # unit, graph and API tests; no API key needed
python -m tests.e2e                 # starts the real API and UI servers and runs the whole flow over HTTP
python -m tests.eval_extraction     # real LLM reading accuracy on the scans; needs a key and costs money
```

`pytest` and `tests.e2e` use a stand-in extractor that returns the answer files. They test the
pipeline, validation and review flow, but not how well the model reads invoices.

## Test invoices

```
python -m tests.fixtures.generate
```

This writes the invoices to `tests/fixtures/generated/`. They are synthetic and reproducible, and are not
committed to git. Each invoice has a matching `.json` answer file containing:

- `raw`: the values exactly as printed
- `truth`: the parsed values
- `expected_issues`: the flags the validator must raise (empty for a clean invoice)

Clean invoices cover the cases most likely to cause false flags, such as round-off lines, tax-inclusive
prices, several tax rates, lakh and European number formats, and multi-page invoices. Each invoice with an
error has one planted problem. Scanned copies are image-only PDFs, PNGs and JPGs, with varying levels of
skew, blur and noise.
