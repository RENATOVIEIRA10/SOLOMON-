#!/usr/bin/env python3
"""Parse MAG DITA + DIT matrices (paginas 11-12, 17-133) into CSV.

Layout comum das matrizes DIT/DITA:
- Titulo da pagina: "DIT + X - FRANQUIA DE Y DIAS (CODIGOS)" + "GRUPO X SUSEP: ..."
- Header row (idades): 4-8 faixas etarias, ex "16 a 30 anos", "31 a 35 anos", ...
- Data rows: [renda_mensal, capital_morte, capital_invalidez, rate_faixa1, rate_faixa2, ...]
  - MQC variantes: [renda_mensal, capital_mqc, rate_faixa1, rate_faixa2, ...] (sem capital_inv)
- Para MQC o genero pode vir no titulo ("FEMININO" ou "MASCULINO")

Ratos sao emitidos como fixed_brl_monthly com period = "F{7|10}_R{renda}_C{capital}"
(codifica franquia + renda + capital em string de period).

Output: C:/tmp/mag_dita_dit.csv
"""
from __future__ import annotations
import csv
import os
import re
import sys
from typing import Iterator, Optional

import pdfplumber

PDF_PATH = r"C:\tmp\mag_guia_vendas.pdf"
CSV_OUT = r"C:\tmp\mag_dita_dit.csv"
INSURER_ID = "2f9b2aa3-51ac-45ae-a3d2-f99d8720f273"
SOURCE_DOC = "Guia de Vendas por Cobertura - v02 (MAG).pdf"
VERSION = "MAR/2025"
RATE_UNIT = "fixed_brl_monthly"

# Age range header regex: "16 a 30 anos" / "18 a 30\nanos"
AGE_RE = re.compile(r"(\d{2})\s*a\s*(\d{2})\s*anos?", re.IGNORECASE)
# BRL number: "1.000,00" / "R$ 1.000" / "13,37" / "R$ 13,37"
NUM_RE = re.compile(r"R?\$?\s*([\d\.]+(?:,\d+)?)")


def parse_brl(s: str) -> Optional[float]:
    if s is None:
        return None
    s = s.strip()
    if not s or s in ("-", "–", "--"):
        return None
    m = NUM_RE.search(s)
    if not m:
        return None
    try:
        return float(m.group(1).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def parse_int_brl(s: str) -> Optional[int]:
    v = parse_brl(s)
    if v is None:
        return None
    return int(round(v))


def extract_age_ranges(header_cells: list) -> list[tuple[int, int, int]]:
    """Return list of (col_idx, age_start, age_end) for each age-range col in header."""
    out = []
    for i, c in enumerate(header_cells):
        if not c:
            continue
        m = AGE_RE.search(str(c))
        if m:
            out.append((i, int(m.group(1)), int(m.group(2))))
    return out


def detect_section_context(page_text: str, prev: dict) -> dict:
    """Update running section context from page title text.
    Context carries: group (MEDICOS, 1, 2, 3, GERAL), product (MAC_IPAM, MQC, DITA),
    franquia (7, 10, None), gender (M, F, None for unissex), susep codes.
    Inherits from prev when new page has no title.
    """
    ctx = dict(prev)
    u = page_text.upper()
    # Normalize common encoding noise: replacement char, accented chars, CRLF
    u_norm = re.sub(r"[\ufffd\xc3\xa1\xe1]", "A", u)

    # Group detection (check most specific first). Use SUSEP to disambiguate:
    # 15414.600179 = Grupo Medicos; 15414.600178 = Grupos 1/2/3
    if "GRUPO 3" in u_norm or "GRUPO3" in u_norm:
        ctx["group"] = "GRUPO_3"
    elif "GRUPO 2" in u_norm or "GRUPO2" in u_norm:
        ctx["group"] = "GRUPO_2"
    elif "GRUPO 1" in u_norm or "GRUPO1" in u_norm:
        ctx["group"] = "GRUPO_1"
    elif "15414.600179" in u_norm or "MEDICOS" in u_norm or re.search(r"M.DICOS", u_norm):
        ctx["group"] = "MEDICOS"

    # Product detection
    if "DITA" in u_norm and "(2330)" in u_norm:
        ctx["product"] = "DITA"
    elif "MAC + IPAM" in u_norm or "MAC+IPAM" in u_norm:
        ctx["product"] = "DIT_MAC_IPAM"
    elif "MQC" in u_norm:
        ctx["product"] = "DIT_MQC"

    # Franquia
    if re.search(r"FRANQUIA\s*DE?\s*7", u_norm):
        ctx["franquia"] = "7"
    elif re.search(r"FRANQUIA\s*DE?\s*10", u_norm):
        ctx["franquia"] = "10"

    # Gender (MQC tem tabelas separadas por sexo)
    if "FEMININO" in u_norm:
        ctx["gender"] = "F"
    elif "MASCULINO" in u_norm:
        ctx["gender"] = "M"
    else:
        if "DIT" in u_norm and "FRANQUIA" in u_norm and ("FEMININO" not in u_norm and "MASCULINO" not in u_norm):
            ctx["gender"] = None

    # SUSEP product codes: aceita 1 ou mais separados por /
    # ex "(2330)" ou "(2400/2532/2684/2679)" ou "(2396/2421)"
    m = re.search(r"\((\d{4}(?:/\d{4})*)\)", u_norm)
    if m:
        ctx["susep_codes"] = m.group(1)

    return ctx


def product_name_of(ctx: dict) -> str:
    """Human-readable product name from context."""
    group = ctx.get("group") or "GERAL"
    base = ctx.get("product") or "UNKNOWN"
    franquia = ctx.get("franquia")
    gender = ctx.get("gender")
    if base == "DITA":
        return "DITA"
    parts = []
    if base == "DIT_MAC_IPAM":
        parts.append("DIT MAC+IPAM")
    elif base == "DIT_MQC":
        parts.append("DIT MQC")
    else:
        parts.append(base)
    if group == "MEDICOS":
        parts.append("MEDICOS")
    elif group == "GRUPO_1":
        parts.append("GRUPO 1")
    elif group == "GRUPO_2":
        parts.append("GRUPO 2")
    elif group == "GRUPO_3":
        parts.append("GRUPO 3")
    if franquia:
        parts.append(f"F{franquia}")
    if gender:
        parts.append("FEMININO" if gender == "F" else "MASCULINO")
    return " ".join(parts)


def product_code_of(ctx: dict) -> str:
    codes = ctx.get("susep_codes") or ""
    # Primeiro codigo
    return codes.split("/")[0] if codes else ""


def iter_data_rows(table: list) -> Iterator[tuple[int, list]]:
    """Yield (row_idx, cells) for data rows (rows with 3+ numeric tokens)."""
    for i, row in enumerate(table):
        if not row:
            continue
        numeric_count = sum(1 for c in row if c and NUM_RE.search(str(c)))
        if numeric_count >= 4:  # at least renda + capital + 2 rates
            yield i, row


def parse_page(pdf, page_idx: int, ctx: dict) -> tuple[list[dict], dict]:
    """Parse one page. Returns (rows, updated_ctx)."""
    page = pdf.pages[page_idx]
    text = page.extract_text() or ""

    # Detectar se esta pagina tem um NOVO titulo (nova secao). Se sim, reset last_layout
    # porque o layout pode mudar.
    title_changed = bool(re.search(r"FRANQUIA\s+DE?\s+(7|10)", text.upper()) or
                         re.search(r"GRUPO\s*[123]", text.upper()) or
                         "(2330)" in text.upper())

    ctx = detect_section_context(text, ctx)
    if title_changed:
        ctx["last_age_ranges"] = None
        ctx["last_meta_cols"] = None

    rows_out: list[dict] = []

    try:
        tables = page.extract_tables()
    except Exception as e:
        print(f"  p{page_idx+1}: extract_tables failed: {e}", file=sys.stderr)
        return rows_out, ctx

    if not tables:
        return rows_out, ctx

    for tbl in tables:
        if not tbl or len(tbl) < 2:
            continue

        # Find header row (first row with >=2 age ranges)
        header_idx = None
        age_ranges: list[tuple[int, int, int]] = []
        for i, row in enumerate(tbl[:6]):
            if not row:
                continue
            ranges = extract_age_ranges(row)
            if len(ranges) >= 2:
                header_idx = i
                age_ranges = ranges
                break

        # Se nao achou header nesta tabela, tentar usar last_age_ranges (continuacao)
        meta_cols: Optional[int] = None
        if not age_ranges:
            if ctx.get("last_age_ranges") and ctx.get("last_meta_cols"):
                age_ranges = ctx["last_age_ranges"]
                meta_cols = ctx["last_meta_cols"]
                header_idx = -1  # data comeca na row 0
            else:
                continue

        if meta_cols is None:
            # Determine layout: how many non-age cols come before age ranges?
            first_age_col = age_ranges[0][0]
            if first_age_col < 2:
                continue
            meta_cols = first_age_col

        product_name = product_name_of(ctx)
        product_code = product_code_of(ctx)

        if not product_code:
            continue  # No SUSEP code detected yet, skip

        # Persist layout for subsequent pages (continuacao)
        ctx["last_age_ranges"] = age_ranges
        ctx["last_meta_cols"] = meta_cols

        data_start = (header_idx + 1) if header_idx >= 0 else 0
        for i, row in enumerate(tbl[data_start:], start=data_start):
            numeric_count = sum(1 for c in row if c and NUM_RE.search(str(c)))
            if numeric_count < 2 + min(len(age_ranges), 4):
                continue

            renda = parse_int_brl(row[0])
            if renda is None or renda < 100:
                continue
            if meta_cols >= 3:
                capital = parse_int_brl(row[1])
            else:
                capital = parse_int_brl(row[1])  # capital_mqc
            if capital is None or capital < 100:
                continue

            franquia = ctx.get("franquia") or "X"
            period = f"F{franquia}_R{renda}_C{capital}"

            for (col, a0, a1) in age_ranges:
                if col >= len(row):
                    continue
                rate = parse_brl(row[col])
                if rate is None or rate <= 0:
                    continue
                for age in range(a0, a1 + 1):
                    # Expand unissex if gender is None
                    genders = [ctx.get("gender")] if ctx.get("gender") else ["M", "F"]
                    for g in genders:
                        rows_out.append({
                            "insurer_id": INSURER_ID,
                            "product_name": product_name,
                            "product_code": product_code,
                            "portfolio": "",
                            "coverage_type": "DIARIA",
                            "gender": g,
                            "age": age,
                            "period": period,
                            "rate": f"{rate:.6f}".rstrip("0").rstrip("."),
                            "rate_unit": RATE_UNIT,
                            "source_doc_name": SOURCE_DOC,
                            "source_page": page_idx + 1,
                            "version_label": VERSION,
                        })

    return rows_out, ctx


def main() -> int:
    all_rows: list[dict] = []
    ctx = {"group": None, "product": None, "franquia": None, "gender": None, "susep_codes": None}

    # Pages 11-12 (DITA) + 17-133 (DIT groups)
    target_pages = list(range(10, 12)) + list(range(16, 133))

    with pdfplumber.open(PDF_PATH) as pdf:
        for idx in target_pages:
            rows, ctx = parse_page(pdf, idx, ctx)
            print(f"p{idx+1}: {len(rows):5d} rows  ctx={ctx.get('group')}/{ctx.get('product')}/F{ctx.get('franquia')}/{ctx.get('gender') or 'U'}")
            all_rows.extend(rows)

    os.makedirs(os.path.dirname(CSV_OUT), exist_ok=True)
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader()
        w.writerows(all_rows)

    print(f"\nwrote {len(all_rows)} rows to {CSV_OUT}")

    from collections import Counter
    c = Counter((r["product_name"], r["product_code"]) for r in all_rows)
    print("\nsummary by (product_name, product_code):")
    for (name, code), cnt in sorted(c.items()):
        print(f"  {cnt:6d}  {code:6s}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
