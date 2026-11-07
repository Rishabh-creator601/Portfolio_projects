# Sample invoices

Synthetic invoices for trying the app. Upload them in the UI.

| File | Invoice no. | What to expect |
| --- | --- | --- |
| `sample_1_clean_multi_rate.pdf` | SMP-2026-001 | Clean. Several GST rates (18/12/5%), CGST+SGST. Should be approved with no flags. |
| `sample_2_clean_interstate.pdf` | SMP-2026-002 | Clean. Interstate sale, IGST. Should be approved with no flags. |
| `sample_3_wrong_total.pdf` | SMP-2026-003 | Grand total is 100.00 too high. Expect total_mismatch, a second read, then human review. |
| `sample_4_bad_gstin.pdf` | SMP-2026-004 | Vendor GSTIN has a wrong check digit. Expect gstin_invalid_checksum and human review. |
| `sample_5_photo_round_off.jpg` | SMP-2026-005 | Photographed (skewed, noisy JPG) clean invoice with a round-off line. Tests scan reading. |
