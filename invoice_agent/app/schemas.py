"""Data shapes shared across the pipeline.

Raw* models hold values exactly as printed on the invoice, so the LLM has no
numeric type to "tidy" a value into and cannot quietly correct a wrong total.
Normalized models hold the parsed Decimal and date values the checks run on.
"""

from datetime import date
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


# ---------- as printed (what extraction returns) ----------

class RawLineItem(BaseModel):
    description: str | None = None
    hsn_sac: str | None = Field(None, description="HSN or SAC code, if printed")
    quantity: str | None = None
    unit_price: str | None = None
    tax_rate: str | None = Field(None, description="Tax rate for this line, if printed per line")
    amount: str | None = None


class RawTaxLine(BaseModel):
    label: str | None = Field(None, description="Tax name as printed, such as CGST, SGST, IGST or VAT")
    rate: str | None = None
    taxable_amount: str | None = Field(None, description="Amount the tax applies to, if printed")
    amount: str | None = None


class RawInvoice(BaseModel):
    vendor_name: str | None = None
    vendor_tax_id: str | None = Field(None, description="Seller's GSTIN or VAT number")
    buyer_name: str | None = None
    buyer_tax_id: str | None = Field(None, description="Buyer's GSTIN or VAT number")
    invoice_number: str | None = None
    invoice_date: str | None = None
    due_date: str | None = None
    place_of_supply: str | None = None
    currency: str | None = None
    prices_include_tax: bool | None = Field(None, description="True if the invoice says prices already include tax")
    line_items: list[RawLineItem] = Field(default_factory=list)
    subtotal: str | None = None
    discount: str | None = None
    shipping: str | None = None
    taxes: list[RawTaxLine] = Field(default_factory=list)
    round_off: str | None = None
    total: str | None = None
    amount_paid: str | None = None
    balance_due: str | None = None


# ---------- parsed (what the checks run on) ----------

class LineItem(BaseModel):
    description: str | None = None
    hsn_sac: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    tax_rate: Decimal | None = None
    amount: Decimal | None = None


class TaxLine(BaseModel):
    label: str | None = None
    rate: Decimal | None = None
    taxable_amount: Decimal | None = None
    amount: Decimal | None = None


class Invoice(BaseModel):
    vendor_name: str | None = None
    vendor_tax_id: str | None = None
    buyer_name: str | None = None
    buyer_tax_id: str | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    due_date: date | None = None
    place_of_supply_code: str | None = Field(None, description="2-digit GST state code")
    currency: str | None = None
    prices_include_tax: bool = False
    line_items: list[LineItem] = Field(default_factory=list)
    subtotal: Decimal | None = None
    discount: Decimal | None = None
    shipping: Decimal | None = None
    taxes: list[TaxLine] = Field(default_factory=list)
    round_off: Decimal | None = None
    total: Decimal | None = None
    amount_paid: Decimal | None = None
    balance_due: Decimal | None = None


# ---------- flags ----------

class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"


class IssueCode(str, Enum):
    # arithmetic
    LINE_AMOUNT_MISMATCH = "line_amount_mismatch"
    SUBTOTAL_MISMATCH = "subtotal_mismatch"
    TOTAL_MISMATCH = "total_mismatch"
    BALANCE_MISMATCH = "balance_mismatch"
    # tax
    TAX_AMOUNT_MISMATCH = "tax_amount_mismatch"
    # GST
    GSTIN_INVALID_FORMAT = "gstin_invalid_format"
    GSTIN_INVALID_CHECKSUM = "gstin_invalid_checksum"
    GST_TYPE_MISMATCH = "gst_type_mismatch"
    CGST_SGST_UNEQUAL = "cgst_sgst_unequal"
    # required fields
    MISSING_FIELD = "missing_field"
    # logic
    FUTURE_INVOICE_DATE = "future_invoice_date"
    DUE_BEFORE_INVOICE = "due_before_invoice"
    NEGATIVE_AMOUNT = "negative_amount"
    # duplicates
    DUPLICATE_INVOICE = "duplicate_invoice"
    # extraction quality
    AMBIGUOUS_NUMBER = "ambiguous_number"
    VALUE_NOT_IN_SOURCE = "value_not_in_source"
    REREAD_CHANGED = "reread_changed"


class Issue(BaseModel):
    code: IssueCode
    severity: Severity
    message: str
    field: str | None = Field(None, description="Dotted path such as total or line_items.2.amount")
    expected: str | None = None
    found: str | None = None
    page: int | None = None
