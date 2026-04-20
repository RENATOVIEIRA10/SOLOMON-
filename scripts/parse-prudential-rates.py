#!/usr/bin/env python3
"""Parse Prudential premium rate table PDF into insurer_rate_tables CSV.

Input: C:\\tmp\\prudential_tabela_premios.pdf (Cod1645 V15 MAR26)
Output: c:\\tmp\\prudential_rates.csv + parse_log.txt

Strategy per page:
1. Detect header block (title, portfolio, coverage_type, version)
2. Extract product_codes appearing in header (regex)
3. Parse data rows starting with 2-digit age; split numeric values
4. Map (values) -> (product_code, gender, period) based on column count
5. Emit rows; log any unparseable page for manual review

Shapes supported v1:
- C: age M F (1 code)
- A: age1 M1 F1 age2 M2 F2 (1 code, side-by-side)
- B: age M1 F1 M2 F2 ... Mk Fk (k codes)
- B': age1 M1 F1 ... Mk Fk age2 M2 F2 ... (k codes side-by-side)

Shapes deferred v2:
- D: complex modificado with period subcolumns (page 11)
- Continuation pages where age starts >20
"""

import csv
import os
import re
import sys
import unicodedata
import pdfplumber

PDF = r"C:\tmp\prudential_tabela_premios.pdf"
CSV_OUT = r"C:\tmp\prudential_rates.csv"
LOG_OUT = r"C:\tmp\prudential_parse_log.txt"

INSURER_ID = "dac17baa-c623-4023-9184-3ed2049a6237"
SOURCE_DOC = "Cod1645 V15 Mar26 - Tabela de Premios (Prudential).pdf"
VERSION = "V15 MAR26"

NUM_RE = re.compile(r"\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+,\d+|\d+\.\d+|\d+")
AGE_LINE_RE = re.compile(r"^\s*(\d{2})(?=\s)")
# Known product code pattern: 2-4 letters + 1-2 digits + optional single letter suffix.
# Filters out noise like IDADE, MASC, FEM, PORTF (portuguese words in caps).
CODE_RE = re.compile(r"\b([A-Z]{2,4}\d{1,2}[A-Z]?)\b")
BLOCKLIST_CODES = {
    "IDADE",
    "MASC",
    "FEM",
    "PORTF",
    "COD",
    "SEXO",
    "CAPITAL",
    "TABELA",
    "COB",
    "ASM",
    "CLA",
    "DE",
    "POR",
    "PROT",
    "SEG",
    "SEGURO",
    "BRASIL",
    "VIDA",
    "MODE",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def to_number(raw: str) -> float | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    # Brazilian format: "1.234,56" -> 1234.56. Also plain "0,5190" -> 0.5190.
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def detect_header(lines: list[str]) -> dict:
    """Extract product_name, portfolio, coverage_type, codes from page header."""
    header = {
        "product_name": None,
        "portfolio": None,
        "coverage_type": "BASICA",
        "codes": [],
    }
    # Title line: starts with SEGURO or contains COBERTURA
    for i, l in enumerate(lines[:6]):
        u = l.strip()
        if not u:
            continue
        if u.startswith("SEGURO") or "COBERTURA" in u:
            # remove "- COBERTURA BASICA/OPCIONAL" suffix
            title = re.split(r"\s[-\u2013\u2014]\s+COBERTURA", u, maxsplit=1)[0]
            header["product_name"] = strip_accents(title).strip()
            if "OPCIONAL" in u:
                header["coverage_type"] = "OPCIONAL"
            elif "BASICA" in strip_accents(u):
                header["coverage_type"] = "BASICA"
            break
    # Portfolio: look in first 4 lines
    for l in lines[:5]:
        u = strip_accents(l).upper()
        if "PORTFOLIO F" in u:
            header["portfolio"] = "F"
            break
        if "PORTFOLIO G" in u and "PROTECAO" not in u:
            header["portfolio"] = "G"
            break
        if "PROTECAO EM VIDA" in u:
            header["portfolio"] = "PROTECAO_EM_VIDA"
            break
    # Mixed header "PORTFOLIO G e PROTECAO EM VIDA"
    for l in lines[:5]:
        u = strip_accents(l).upper()
        if "PORTFOLIO G" in u and "PROTECAO" in u:
            header["portfolio"] = "G_E_PROTECAO"
            break
    # Codes: scan first 8 lines for code pattern, filter blocklist
    seen = set()
    codes: list[str] = []
    for l in lines[:8]:
        for m in CODE_RE.finditer(l):
            c = m.group(1)
            if c in BLOCKLIST_CODES:
                continue
            if c in seen:
                continue
            seen.add(c)
            codes.append(c)
    header["codes"] = codes
    return header


def parse_page(page_num: int, text: str) -> tuple[list[dict], str | None]:
    """Return (rows, error_or_none). Each row has keys matching CSV columns."""
    if not text:
        return [], "empty page"
    lines = text.split("\n")
    hdr = detect_header(lines)
    if not hdr["product_name"]:
        return [], "no product_name"
    if not hdr["codes"]:
        return [], f"no codes detected in header (product={hdr['product_name']})"

    codes = hdr["codes"]
    rows: list[dict] = []
    per_row_vals_seen: set[int] = set()

    # Iterate data lines (start with age)
    data_lines = [l for l in lines if AGE_LINE_RE.match(l)]
    if not data_lines:
        return [], "no data rows"

    # Find expected layout: try each row
    for dl in data_lines:
        nums = NUM_RE.findall(dl)
        # First number is age; remainder are rates (could include a second age for side-by-side)
        if not nums:
            continue
        try:
            age = int(nums[0])
        except ValueError:
            continue
        rest = nums[1:]
        rest_vals = [to_number(x) for x in rest]
        per_row_vals_seen.add(len(rest_vals))

        n_codes = len(codes)
        expected_single = 2 * n_codes
        expected_side = 2 * n_codes + 1 + 2 * n_codes  # second age + another block

        if len(rest_vals) == expected_single:
            # Single age row: (M,F) per code
            for idx, code in enumerate(codes):
                m_val = rest_vals[idx * 2]
                f_val = rest_vals[idx * 2 + 1]
                if m_val is not None:
                    rows.append(_mkrow(hdr, code, "M", age, m_val, page_num))
                if f_val is not None:
                    rows.append(_mkrow(hdr, code, "F", age, f_val, page_num))
        elif len(rest_vals) == expected_side and n_codes == 1:
            # Side-by-side shape A: age M F age2 M2 F2
            for (a, m, f) in [(age, rest_vals[0], rest_vals[1]),
                              (int(rest[2]) if rest[2].isdigit() else None, rest_vals[3], rest_vals[4])]:
                if a is None:
                    continue
                if m is not None:
                    rows.append(_mkrow(hdr, codes[0], "M", a, m, page_num))
                if f is not None:
                    rows.append(_mkrow(hdr, codes[0], "F", a, f, page_num))
        else:
            # Deferred shape
            continue

    if not rows:
        return [], f"no rows matched expected layout (codes={codes}, per_row_vals={per_row_vals_seen})"
    return rows, None


def _mkrow(hdr: dict, code: str, gender: str, age: int, rate: float, page: int) -> dict:
    return {
        "insurer_id": INSURER_ID,
        "product_name": hdr["product_name"],
        "product_code": code,
        "portfolio": hdr["portfolio"] or "",
        "coverage_type": hdr["coverage_type"],
        "gender": gender,
        "age": age,
        "period": "",
        "rate": f"{rate:.6f}".rstrip("0").rstrip("."),
        "rate_unit": "per_1000_annual",
        "source_doc_name": SOURCE_DOC,
        "source_page": page,
        "version_label": VERSION,
    }


def main() -> int:
    log_lines = []
    all_rows: list[dict] = []
    with pdfplumber.open(PDF) as pdf:
        for i, page in enumerate(pdf.pages):
            pn = i + 1
            text = page.extract_text() or ""
            text = strip_accents(text).replace("\uFFFD", "")
            rows, err = parse_page(pn, text)
            if err:
                log_lines.append(f"page {pn:2d}: SKIP - {err}")
            else:
                log_lines.append(f"page {pn:2d}: OK - {len(rows):4d} rows | codes={set(r['product_code'] for r in rows)}")
                all_rows.extend(rows)

    # Write CSV
    os.makedirs(os.path.dirname(CSV_OUT), exist_ok=True)
    if all_rows:
        with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
            w.writeheader()
            w.writerows(all_rows)

    with open(LOG_OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))
        f.write(f"\n\nTOTAL ROWS: {len(all_rows)}\n")

    print(f"parsed {len(all_rows)} rows from {pn} pages")
    print(f"CSV: {CSV_OUT}")
    print(f"LOG: {LOG_OUT}")
    # Print log summary inline
    print("\n--- parse log ---")
    for l in log_lines:
        print(l)
    return 0


if __name__ == "__main__":
    sys.exit(main())
