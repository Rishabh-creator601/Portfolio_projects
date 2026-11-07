"""Deterministic invoice checks. No LLM is involved in anything in this package."""

from datetime import date

from app.schemas import Invoice, Issue

from .arithmetic import check_arithmetic, check_tax_amounts
from .gst import check_gst
from .rules import check_logic, check_required, check_source

__all__ = ["validate", "check_source"]


def validate(invoice: Invoice, today: date) -> list[Issue]:
    return (check_required(invoice) + check_arithmetic(invoice) + check_tax_amounts(invoice)
            + check_gst(invoice) + check_logic(invoice, today))
