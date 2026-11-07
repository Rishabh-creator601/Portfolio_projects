"""Streamlit front end. Start with: streamlit run ui/app.py"""

import pandas as pd
import streamlit as st

import api_client as api

STATUS_LABELS = {"queued": "Queued", "processing": "Processing", "needs_review": "Needs review",
                 "approved": "Approved", "failed": "Failed"}
LINE_FIELDS = {"description": "Description", "hsn_sac": "HSN/SAC", "quantity": "Qty", "unit_price": "Unit price",
               "tax_rate": "Tax rate %", "amount": "Amount"}
TAX_FIELDS = {"label": "Tax", "rate": "Rate %", "taxable_amount": "Taxable amount", "amount": "Amount"}
HEADER_FIELDS = [
    ("vendor_name", "Vendor"), ("vendor_tax_id", "Vendor GSTIN / tax ID"), ("buyer_name", "Buyer"),
    ("buyer_tax_id", "Buyer GSTIN / tax ID"), ("invoice_number", "Invoice number"), ("currency", "Currency"),
    ("invoice_date", "Invoice date (YYYY-MM-DD)"), ("due_date", "Due date (YYYY-MM-DD)"),
    ("place_of_supply_code", "Place of supply code"),
]
TOTAL_FIELDS = [
    ("subtotal", "Subtotal"), ("discount", "Discount"), ("shipping", "Shipping"), ("round_off", "Round off"),
    ("total", "Total"), ("amount_paid", "Amount paid"), ("balance_due", "Balance due"),
]

st.set_page_config(page_title="Invoice Agent", page_icon=":material/receipt_long:", layout="wide")


def status_table(invoices: list[dict]) -> pd.DataFrame:
    return pd.DataFrame([{
        "File": i["filename"], "Status": STATUS_LABELS.get(i["status"], i["status"]), "Vendor": i["vendor"],
        "Invoice no": i["invoice_number"], "Total": i["total"], "Currency": i["currency"], "Errors": i["error_count"],
        "Warnings": i["warning_count"], "Reviewed": i["reviewed"], "Problem": i["error"],
    } for i in invoices])


# ---------- Upload ----------

@st.fragment(run_every="3s")
def upload_progress():
    invoices = api.list_invoices()
    if not invoices:
        return
    active = sum(i["status"] in {"queued", "processing"} for i in invoices)
    done = len(invoices) - active
    st.progress(done / len(invoices), text=f"{done} of {len(invoices)} invoices processed")
    st.dataframe(status_table(invoices[::-1]), hide_index=True, width="stretch")


def upload_page():
    st.title("Upload invoices")
    st.caption("PDFs and scans are read, checked, and any problems are flagged for review.")

    run = st.session_state.get("uploader_run", 0)
    files = st.file_uploader("Invoice files", type=["pdf", "png", "jpg", "jpeg"], accept_multiple_files=True,
                             key=f"uploader_{run}")
    if st.button("Process invoices", type="primary", disabled=not files):
        try:
            result = api.upload([(f.name, f.getvalue()) for f in files])
        except api.ApiError as error:
            st.error(str(error))
        else:
            st.session_state.uploader_run = run + 1
            st.session_state.upload_result = result
            st.rerun()

    result = st.session_state.pop("upload_result", None)
    if result:
        st.success(f"Added {len(result['accepted'])} invoice(s) to the queue.")
        for rejected in result["rejected"]:
            st.error(f"{rejected['filename']}: {rejected['reason']}")
    upload_progress()


# ---------- Queue ----------

def queue_page():
    st.title("Invoice queue")
    invoices = api.list_invoices()
    if not invoices:
        st.info("No invoices yet. Add some on the Upload page.")
        return

    count = lambda *statuses: sum(i["status"] in statuses for i in invoices)
    columns = st.columns(4)
    columns[0].metric("Total", len(invoices))
    columns[1].metric("Approved", count("approved"))
    columns[2].metric("Needs review", count("needs_review"))
    columns[3].metric("Failed", count("failed"))

    choice = st.segmented_control("Show", ["All", *STATUS_LABELS.values()], default="All")
    shown = [i for i in invoices if choice in (None, "All") or STATUS_LABELS.get(i["status"]) == choice]
    if not shown:
        st.info("No invoices with this status.")
        return
    st.caption("Select a row to open it.")
    table = st.dataframe(status_table(shown), hide_index=True, width="stretch", on_select="rerun",
                         selection_mode="single-row", key=f"queue_{choice}")
    rows = table.selection.rows
    if rows:
        st.session_state.review_id = shown[rows[0]]["id"]
        st.switch_page(REVIEW_PAGE)


# ---------- Review ----------

def _text(value) -> str:
    return "" if value is None else str(value)


def _rows(items: list[dict], fields: dict[str, str]) -> pd.DataFrame:
    rows = [{label: _text(item.get(name)) for name, label in fields.items()} for item in items]
    return pd.DataFrame(rows, columns=list(fields.values()), dtype="string")


def _items(frame: pd.DataFrame, fields: dict[str, str]) -> list[dict]:
    items = []
    for _, row in frame.iterrows():
        item = {name: (str(row[label]).strip() or None) if pd.notna(row[label]) else None
                for name, label in fields.items()}
        if any(item.values()):
            items.append(item)
    return items


def show_issues(detail: dict):
    issues = detail["issues"]
    if not issues:
        st.success("All checks passed.")
    for issue in issues:
        where = f" (`{issue['field']}`)" if issue.get("field") else ""
        (st.error if issue["severity"] == "error" else st.warning)(issue["message"] + where)
    if detail["reread_count"] and not detail["reread_changes"]:
        st.caption("A second read gave the same values, so these problems are probably on the invoice itself.")


def correction_form(detail: dict):
    invoice = detail["invoice"]
    with st.form(f"review_{detail['id']}"):
        values = {}
        columns = st.columns(2)
        for i, (name, label) in enumerate(HEADER_FIELDS):
            values[name] = columns[i % 2].text_input(label, _text(invoice.get(name)))

        st.subheader("Line items")
        lines = st.data_editor(_rows(invoice["line_items"], LINE_FIELDS), num_rows="dynamic", hide_index=True,
                               width="stretch")
        st.subheader("Taxes")
        taxes = st.data_editor(_rows(invoice["taxes"], TAX_FIELDS), num_rows="dynamic", hide_index=True,
                               width="stretch")
        st.subheader("Totals")
        columns = st.columns(4)
        for i, (name, label) in enumerate(TOTAL_FIELDS):
            values[name] = columns[i % 4].text_input(label, _text(invoice.get(name)))
        prices_include_tax = st.checkbox("Prices include tax", invoice.get("prices_include_tax", False))

        save, approve = st.columns(2)
        recheck = save.form_submit_button("Save corrections and recheck", type="primary", width="stretch")
        accept = approve.form_submit_button("Approve as it is", width="stretch")

    if not (recheck or accept):
        return
    try:
        if accept:
            api.review(detail["id"], {"action": "approve"})
            st.session_state.review_message = "Invoice approved with its flags kept on record."
        else:
            corrected = {name: value.strip() or None for name, value in values.items()}
            corrected |= {"prices_include_tax": prices_include_tax, "line_items": _items(lines, LINE_FIELDS),
                          "taxes": _items(taxes, TAX_FIELDS)}
            result = api.review(detail["id"], {"action": "correct", "invoice": corrected})
            st.session_state.review_message = ("Corrections saved. All checks now pass."
                                               if result["status"] == "approved"
                                               else "Corrections saved, but some problems remain.")
    except api.ApiError as error:
        st.error(f"Could not save: {error}")
        return
    st.rerun()


def review_page():
    st.title("Review an invoice")
    invoices = api.list_invoices()
    if not invoices:
        st.info("No invoices yet. Add some on the Upload page.")
        return
    invoices.sort(key=lambda i: i["status"] != "needs_review")
    ids = [i["id"] for i in invoices]
    labels = {i["id"]: f"{i['filename']}  ({STATUS_LABELS.get(i['status'], i['status'])})" for i in invoices}

    selected = st.session_state.pop("review_id", None)
    if selected in ids:
        st.session_state.review_select = selected
    elif st.session_state.get("review_select") not in ids:
        st.session_state.review_select = ids[0]
    invoice_id = st.selectbox("Invoice", ids, format_func=labels.get, key="review_select")

    message = st.session_state.pop("review_message", None)
    if message:
        st.toast(message)

    detail = api.get_invoice(invoice_id)
    left, right = st.columns([5, 6], gap="large")
    with left:
        number = 1
        if detail["page_count"] > 1:
            number = st.number_input("Page", 1, detail["page_count"], 1, key=f"page_{invoice_id}")
        st.image(api.page_image(invoice_id, number), width="stretch")
    with right:
        st.subheader("Flags")
        if detail["status"] == "failed":
            st.error(detail["error"] or "This invoice could not be processed.")
            return
        if detail["status"] in {"queued", "processing"}:
            st.info("This invoice is still being processed.")
            return
        show_issues(detail)
        if detail["status"] == "needs_review":
            st.subheader("Invoice details")
            correction_form(detail)
        else:
            st.caption("Reviewed by a person." if detail["reviewed"] else "Passed all checks automatically.")
            st.dataframe(pd.DataFrame(detail["invoice"]["line_items"]), hide_index=True, width="stretch")


# ---------- Export ----------

def export_page():
    st.title("Export to Excel")
    finished = [i for i in api.list_invoices() if i["status"] in {"approved", "needs_review"}]
    if not finished:
        st.info("There are no finished invoices to export yet.")
        return
    include_flagged = st.toggle("Include invoices still waiting for review", value=True)
    chosen = [i for i in finished if include_flagged or i["status"] == "approved"]
    st.write(f"**{len(chosen)}** invoice(s) will be exported, to the sheets Invoices, Line Items and Issues. "
             "Flagged cells are highlighted.")
    if not chosen:
        return
    if st.button("Create workbook", type="primary"):
        try:
            st.session_state.workbook = api.export([i["id"] for i in chosen])
        except api.ApiError as error:
            st.error(str(error))
    if st.session_state.get("workbook"):
        st.download_button("Download invoices.xlsx", st.session_state.workbook, file_name="invoices.xlsx",
                           mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           on_click="ignore")


# ---------- About ----------

PIPELINE_DOT = """
digraph {
    rankdir=LR; bgcolor="transparent";
    node [shape=box, style="rounded,filled", fillcolor="#e8eef6", color="#2f5d8a", fontname="Helvetica", fontsize=11];
    edge [color="#555555", fontname="Helvetica", fontsize=9];

    ingest [label="Ingest\\nopen file, read pages"];
    classify [label="Classify pages\\ntext layer or image"];
    extract [label="Extract\\nLLM reads values\\nas printed", fillcolor="#fdf1d8", color="#b7791f"];
    normalize [label="Normalize\\nstrings → Decimal, dates"];
    validate [label="Validate\\nplain Python checks"];
    reread [label="Reread\\npages as sharper images", fillcolor="#fdf1d8", color="#b7791f"];
    review [label="Human review\\napprove or correct", fillcolor="#fde2e1", color="#c0392b"];
    persist [label="Persist\\nsave result", fillcolor="#e3f4e8", color="#2e7d4f"];

    ingest -> classify -> extract -> normalize -> validate;
    validate -> persist [label="no flags"];
    validate -> reread [label="math error,\\nfirst time"];
    reread -> normalize;
    validate -> review [label="flags remain"];
    review -> validate [label="recheck"];
}
"""

TECH_STACK = [
    ("Pipeline", "LangGraph", "A state graph with a reread loop. Human review pauses it with interrupt(), and the "
                              "SQLite checkpointer saves paused runs so they survive a restart."),
    ("Reading", "OpenAI via langchain-openai", "Structured output into a Pydantic schema, at temperature 0. "
                                               "Uses gpt-4o-mini unless CHAT_MODEL says otherwise."),
    ("Documents", "PyMuPDF", "Opens PDFs and images, finds text layers and renders pages to PNG."),
    ("Data model", "Pydantic, Decimal", "Values stay as printed strings until they are parsed into exact decimals."),
    ("API", "FastAPI, Uvicorn", "Upload, list, page images, review and export endpoints. Work runs on a "
                                "background thread."),
    ("Storage", "SQLite", "Invoice records and graph checkpoints, in two separate files."),
    ("Export", "openpyxl", "A workbook with Invoices, Line Items and Issues sheets, with flagged cells highlighted."),
    ("Front end", "Streamlit, httpx, pandas", "This app, which talks to the API over HTTP."),
    ("Testing", "pytest, ReportLab, Pillow, NumPy", "43 synthetic invoices, some degraded to look like scans, "
                                                    "each with a matching answer file."),
    ("Deployment", "Docker Compose", "Separate API and UI containers, with health checks and a data volume."),
]


def about_page():
    st.title("About Invoice Agent")
    st.write("Invoice Agent reads PDF and scanned invoices, checks the totals and GST details, flags errors "
             "for a person to review, and exports the results to Excel.")
    st.info("**Key design rule:** the LLM only reads the invoice, and plain Python does all the checks. "
            "Values stay as printed strings until they are parsed into exact decimals, so the model has no "
            "chance to quietly correct a wrong total.", icon=":material/rule:")

    st.header("How an invoice moves through the pipeline")
    st.graphviz_chart(PIPELINE_DOT, width="stretch")
    st.caption("Yellow steps call the LLM, red waits for a person, and green ends the run.")

    steps = {
        "Ingest": "Checks the file type and signature, rejects damaged, password-protected or oversized files, "
                  "and reads the text of each page.",
        "Classify pages": "A page with a real text layer is sent to the model as text. A scanned page is sent "
                          "as an image.",
        "Extract": "The LLM copies each value exactly as printed, such as `1,23,456.00` or `1.234,56`, without "
                   "doing any arithmetic.",
        "Normalize": "Turns Indian, US and European number formats into `Decimal`, and parses dates. A value that "
                     "can be read more than one way is flagged rather than guessed.",
        "Validate": "Checks line amounts, subtotal, tax, total and balance due, GSTIN format and checksum, "
                    "CGST+SGST vs IGST against the place of supply, required fields, dates, negative amounts and "
                    "duplicates. For digital PDFs, it also checks that the key amounts and the invoice number "
                    "actually appear in the page text.",
        "Reread": "Runs once, on the first math error. It reads the pages again as sharper images. Changed values "
                  "mean the first read was wrong, and the same values mean the error is probably on the invoice.",
        "Human review": "Pauses the run. A reviewer either approves the invoice with its flags kept on record, or "
                        "corrects the values, which are then checked again.",
        "Persist": "Saves the final values and flags, ready for export.",
    }
    for name, text in steps.items():
        st.markdown(f"**{name}:** {text}")

    st.header("Tech stack")
    st.dataframe(pd.DataFrame(TECH_STACK, columns=["Area", "Tools", "Used for"]), hide_index=True,
                 width="stretch")


# ---------- App ----------

if not api.is_up():
    st.error(f"The API server isn't reachable at {api.API_URL}. Start it, then reload this page.")
    st.stop()

REVIEW_PAGE = st.Page(review_page, title="Review", icon=":material/rule:", url_path="review")
st.navigation([
    st.Page(upload_page, title="Upload", icon=":material/upload_file:", default=True),
    st.Page(queue_page, title="Queue", icon=":material/list_alt:", url_path="queue"),
    REVIEW_PAGE,
    st.Page(export_page, title="Export", icon=":material/table_view:", url_path="export"),
    st.Page(about_page, title="About", icon=":material/info:", url_path="about"),
]).run()
