"""The invoice workflow.

ingest -> classify_pages -> extract -> normalize -> validate -> persist (clean or approved)
                                           ^            |-----> reread (math failed, first time)
                                           |            '-----> human_review (pauses for a person)
                                           '-- reread           human_review -> validate
"""

from datetime import date
from pathlib import Path
from typing import Callable, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.config import Settings
from app.db.store import Store
from app.extraction.llm import Extractor
from app.extraction.normalize import normalize
from app.extraction.pages import has_text_layer, read_pages
from app.schemas import Invoice, Issue, IssueCode, RawInvoice, Severity
from app.validation import check_source, validate

_MATH_CODES = {
    IssueCode.LINE_AMOUNT_MISMATCH.value, IssueCode.SUBTOTAL_MISMATCH.value, IssueCode.TOTAL_MISMATCH.value,
    IssueCode.BALANCE_MISMATCH.value, IssueCode.TAX_AMOUNT_MISMATCH.value,
}
_NOT_COMPARED = {"description", "vendor_name", "buyer_name", "label", "hsn_sac"}


class InvoiceState(TypedDict, total=False):
    invoice_id: str
    file_path: str
    file_hash: str
    pages: list[dict]
    raw: dict
    invoice: dict
    parse_issues: list[dict]
    issues: list[dict]
    reread_count: int
    reread_changes: list[str]
    corrected: bool
    approved: bool


def _flatten(value, prefix="") -> dict:
    if isinstance(value, dict):
        items = {}
        for key, inner in value.items():
            if key not in _NOT_COMPARED:
                items |= _flatten(inner, f"{prefix}.{key}" if prefix else key)
        return items
    if isinstance(value, list):
        items = {}
        for i, inner in enumerate(value):
            items |= _flatten(inner, f"{prefix}.{i}")
        return items
    return {prefix: value}


def diff_invoices(first: Invoice, second: Invoice) -> list[str]:
    """Describe the values that differ between two reads, ignoring free text such as descriptions."""
    a, b = _flatten(first.model_dump(mode="python")), _flatten(second.model_dump(mode="python"))
    return [f"{key}: {a.get(key)} -> {b.get(key)}" for key in sorted(a.keys() | b.keys()) if a.get(key) != b.get(key)]


def result_data(state: dict) -> dict:
    return {key: state.get(key) for key in ("raw", "invoice", "issues", "reread_count", "reread_changes")}


def build_graph(extractor: Extractor, store: Store, checkpointer, settings: Settings,
                today: Callable[[], date] = date.today):

    def ingest(state: InvoiceState):
        store.set_status(state["invoice_id"], "processing")
        return {"pages": read_pages(state["file_path"], settings.max_pages), "reread_count": 0, "reread_changes": []}

    def classify_pages(state: InvoiceState):
        return {"pages": [{**page, "mode": "text" if has_text_layer(page) else "image"} for page in state["pages"]]}

    def extract(state: InvoiceState):
        raw = extractor.extract(Path(state["file_path"]), state["pages"], dpi=settings.extract_dpi)
        return {"raw": raw.model_dump(mode="json")}

    def normalize_node(state: InvoiceState):
        invoice, issues = normalize(RawInvoice.model_validate(state["raw"]))
        return {"invoice": invoice.model_dump(mode="json"), "parse_issues": [i.model_dump(mode="json") for i in issues]}

    def validate_node(state: InvoiceState):
        invoice = Invoice.model_validate(state["invoice"])
        issues = [Issue.model_validate(i) for i in state.get("parse_issues", [])]
        issues += validate(invoice, today())
        if not state.get("corrected"):
            issues += check_source(RawInvoice.model_validate(state["raw"]), state["pages"])
            changes = state.get("reread_changes") or []
            if changes:
                issues.append(Issue(
                    code=IssueCode.REREAD_CHANGED, severity=Severity.WARNING, found="; ".join(changes[:10]),
                    message=f"A second read gave different values for {len(changes)} field(s), so please compare with the document.",
                ))
        duplicate = store.find_duplicate(state["invoice_id"], state["file_hash"], invoice.vendor_name, invoice.invoice_number)
        if duplicate:
            issues.append(Issue(
                code=IssueCode.DUPLICATE_INVOICE, severity=Severity.ERROR, field="invoice_number", found=duplicate["filename"],
                message=f"This looks like a duplicate of '{duplicate['filename']}'.",
            ))
        return {"issues": [i.model_dump(mode="json") for i in issues]}

    def route(state: InvoiceState) -> str:
        if state.get("approved") or not state["issues"]:
            return "persist"
        has_math_error = any(issue["code"] in _MATH_CODES for issue in state["issues"])
        if has_math_error and not state.get("corrected") and state.get("reread_count", 0) == 0:
            return "reread"
        return "human_review"

    def reread(state: InvoiceState):
        """Read the pages again as images. Changed values suggest a misread; the same values suggest a real error."""
        second = extractor.extract(Path(state["file_path"]), state["pages"], force_images=True, dpi=settings.reread_dpi)
        first_invoice = Invoice.model_validate(state["invoice"])
        second_invoice, _ = normalize(second)
        return {"raw": second.model_dump(mode="json"), "reread_count": 1,
                "reread_changes": diff_invoices(first_invoice, second_invoice)}

    def human_review(state: InvoiceState):
        # On resume this node runs again from the top, so nothing with side effects goes before interrupt().
        decision = interrupt({"issues": state["issues"]})
        if decision["action"] == "approve":
            return {"approved": True}
        return {"invoice": decision["invoice"], "parse_issues": [], "corrected": True}

    def persist(state: InvoiceState):
        reviewed = bool(state.get("approved") or state.get("corrected"))
        store.save_result(state["invoice_id"], "approved", result_data(state), reviewed)
        return {}

    graph = StateGraph(InvoiceState)
    graph.add_node("ingest", ingest)
    graph.add_node("classify_pages", classify_pages)
    graph.add_node("extract", extract)
    graph.add_node("normalize", normalize_node)
    graph.add_node("validate", validate_node)
    graph.add_node("reread", reread)
    graph.add_node("human_review", human_review)
    graph.add_node("persist", persist)

    graph.add_edge(START, "ingest")
    graph.add_edge("ingest", "classify_pages")
    graph.add_edge("classify_pages", "extract")
    graph.add_edge("extract", "normalize")
    graph.add_edge("normalize", "validate")
    graph.add_conditional_edges("validate", route, ["persist", "reread", "human_review"])
    graph.add_edge("reread", "normalize")
    graph.add_edge("human_review", "validate")
    graph.add_edge("persist", END)
    return graph.compile(checkpointer=checkpointer)
