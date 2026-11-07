"""India GST checks: GSTIN validity and CGST + SGST vs IGST.

The supply type compares the seller's state with the place of supply. SEZ supplies
and exports follow different rules and may be flagged for a person to review.
"""

from decimal import Decimal

from app.config import TOLERANCE
from app.gst import has_valid_checksum, has_valid_format, state_code
from app.schemas import Invoice, Issue, IssueCode, Severity

_LOCAL = {"CGST", "SGST", "UTGST"}


def is_gst_invoice(inv: Invoice) -> bool:
    return inv.currency == "INR" or any(tax.label in _LOCAL | {"IGST"} for tax in inv.taxes)


def _check_gstin(value: str | None, field: str, who: str) -> list[Issue]:
    if not value:
        return []
    if not has_valid_format(value):
        return [Issue(code=IssueCode.GSTIN_INVALID_FORMAT, severity=Severity.ERROR, field=field, found=value,
                      message=f"The {who} GSTIN '{value}' does not have a valid format.")]
    if not has_valid_checksum(value):
        return [Issue(code=IssueCode.GSTIN_INVALID_CHECKSUM, severity=Severity.ERROR, field=field, found=value,
                      message=f"The {who} GSTIN '{value}' fails the check-digit test, so it may be mistyped or misread.")]
    return []


def check_gst(inv: Invoice) -> list[Issue]:
    if not is_gst_invoice(inv):
        return []
    issues = _check_gstin(inv.vendor_tax_id, "vendor_tax_id", "seller") + _check_gstin(inv.buyer_tax_id, "buyer_tax_id", "buyer")
    if not inv.vendor_tax_id:
        issues.append(Issue(code=IssueCode.MISSING_FIELD, severity=Severity.ERROR, field="vendor_tax_id",
                            message="The seller GSTIN is missing."))

    labels = {tax.label for tax in inv.taxes}
    seller = state_code(inv.vendor_tax_id) if inv.vendor_tax_id and has_valid_format(inv.vendor_tax_id) else None
    place = inv.place_of_supply_code
    if not place and inv.buyer_tax_id and has_valid_format(inv.buyer_tax_id):
        place = state_code(inv.buyer_tax_id)
    if seller and place:
        if seller == place and "IGST" in labels:
            issues.append(Issue(code=IssueCode.GST_TYPE_MISMATCH, severity=Severity.ERROR, field="taxes",
                                expected="CGST + SGST", found="IGST",
                                message=f"Seller and place of supply are both in state {seller}, so CGST + SGST should apply, not IGST."))
        elif seller != place and labels & _LOCAL:
            issues.append(Issue(code=IssueCode.GST_TYPE_MISMATCH, severity=Severity.ERROR, field="taxes",
                                expected="IGST", found="CGST + SGST",
                                message=f"Seller is in state {seller} and place of supply is {place}, so IGST should apply, not CGST + SGST."))

    central = sum((tax.amount for tax in inv.taxes if tax.label == "CGST" and tax.amount is not None), Decimal(0))
    state = sum((tax.amount for tax in inv.taxes if tax.label in {"SGST", "UTGST"} and tax.amount is not None), Decimal(0))
    if labels & {"CGST"} and labels & {"SGST", "UTGST"} and abs(central - state) > TOLERANCE:
        issues.append(Issue(code=IssueCode.CGST_SGST_UNEQUAL, severity=Severity.ERROR, field="taxes",
                            expected="Equal amounts", found=f"CGST {central:,.2f}, SGST {state:,.2f}",
                            message=f"CGST and SGST should be equal, but they are {central:,.2f} and {state:,.2f}."))
    return issues
