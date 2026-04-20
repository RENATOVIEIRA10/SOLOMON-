#!/usr/bin/env python3
"""Parse MAG Seguros rate table PDF (Guia de Vendas por Cobertura MAR/2025) into CSV.

Strategy: PDF has heterogeneous tables (unissex idade-a-idade, faixas etarias,
multi-produto compartilhando tabela, matrizes renda x capital). First pass cobre
paginas 5-16 com dados hardcoded a partir do texto extraido. DITA/DIT (11-12 e
17-133) sao matrizes renda x capital x faixa etaria e ficam para v2.

Regra para faixas etarias: expandir cada faixa em linhas individuais (e.g.
"16 a 25 anos" emite age=16..25) para manter contrato uniforme com a tabela
(idade inteira). Unissex emite 2 linhas (M e F) com mesma taxa.

Output: c:/tmp/mag_rates.csv
"""
import csv
import os
import sys

INSURER_ID = "2f9b2aa3-51ac-45ae-a3d2-f99d8720f273"
SOURCE_DOC = "Guia de Vendas por Cobertura - v02 (MAG).pdf"
VERSION = "MAR/2025"
RATE_UNIT_CAPITAL = "per_1000_monthly"  # todas as tabelas sao "por R$1.000 de CS, mensal"
RATE_UNIT_RENDA = "per_1000_renda_monthly"  # Pensao/Renda: por R$1.000 de Renda
RATE_UNIT_DIARIA = "per_100_diaria_monthly"  # DIH/UTI: por R$100 de diaria
CSV_OUT = r"C:\tmp\mag_rates.csv"


def mk(product_name: str, product_code: str, coverage_type: str, gender: str,
       age: int, period: str, rate: float, page: int, unit: str = RATE_UNIT_CAPITAL,
       portfolio: str = "") -> dict:
    return {
        "insurer_id": INSURER_ID,
        "product_name": product_name,
        "product_code": product_code,
        "portfolio": portfolio,
        "coverage_type": coverage_type,
        "gender": gender,
        "age": age,
        "period": period,
        "rate": f"{rate:.6f}".rstrip("0").rstrip("."),
        "rate_unit": unit,
        "source_doc_name": SOURCE_DOC,
        "source_page": page,
        "version_label": VERSION,
    }


def unissex(*args, **kwargs):
    """Emit M and F rows with same rate."""
    out = []
    for g in ("M", "F"):
        kwargs["gender"] = g
        out.append(mk(*args, **kwargs))
    return out


def idade_unissex_rows(product_name, code, coverage_type, page, table_map, unit=RATE_UNIT_CAPITAL):
    """table_map: dict {age: rate} -> emit unissex rows."""
    rows = []
    for age, rate in table_map.items():
        rows.extend(unissex(product_name, code, coverage_type, age=age, period="", rate=rate, page=page, unit=unit))
    return rows


def faixa_unissex_rows(product_name, code, coverage_type, page, ranges, unit=RATE_UNIT_CAPITAL, period=""):
    """ranges: list of (age_start, age_end, rate) -> expand and emit unissex."""
    rows = []
    for (a0, a1, rate) in ranges:
        for age in range(a0, a1 + 1):
            rows.extend(unissex(product_name, code, coverage_type, age=age, period=period, rate=rate, page=page, unit=unit))
    return rows


def faixa_periods_rows(product_name, code, coverage_type, page, period_ranges, unit=RATE_UNIT_CAPITAL):
    """period_ranges: list of dicts {a0, a1, period1: rate, period2: rate, ...}.
    Emits separate rows per period (unissex)."""
    rows = []
    for entry in period_ranges:
        a0 = entry["a0"]
        a1 = entry["a1"]
        for k, v in entry.items():
            if k in ("a0", "a1"):
                continue
            if v is None:
                continue
            period = k
            for age in range(a0, a1 + 1):
                rows.extend(unissex(product_name, code, coverage_type, age=age, period=period, rate=v, page=page, unit=unit))
    return rows


def idade_periods_rows(product_name, code, coverage_type, page, age_periods, unit=RATE_UNIT_CAPITAL):
    """age_periods: dict {age: {period: rate}} unissex."""
    rows = []
    for age, periods in age_periods.items():
        for period, rate in periods.items():
            if rate is None:
                continue
            rows.extend(unissex(product_name, code, coverage_type, age=age, period=period, rate=rate, page=page, unit=unit))
    return rows


def gender_faixas_rows(product_name, code, coverage_type, page, ranges_by_gender, unit=RATE_UNIT_CAPITAL):
    """ranges_by_gender: {'M': [(a0,a1,rate),...], 'F': [...]} gender-specific."""
    rows = []
    for g, ranges in ranges_by_gender.items():
        for (a0, a1, rate) in ranges:
            for age in range(a0, a1 + 1):
                rows.append(mk(product_name, code, coverage_type, g, age, "", rate, page, unit))
    return rows


# ============================================================
# Page 5 - VIDA INTEIRA (3082) - unissex idade-a-idade
# ============================================================
VIDA_INTEIRA = {
    16: 0.10, 17: 0.10, 18: 0.11, 19: 0.11, 20: 0.12,
    21: 0.12, 22: 0.12, 23: 0.13, 24: 0.13, 25: 0.13,
    26: 0.14, 27: 0.14, 28: 0.14, 29: 0.14, 30: 0.15,
    31: 0.15, 32: 0.16, 33: 0.16, 34: 0.17, 35: 0.18,
    36: 0.18, 37: 0.19, 38: 0.20, 39: 0.22, 40: 0.24,
    41: 0.26, 42: 0.29, 43: 0.31, 44: 0.35, 45: 0.38,
    46: 0.42, 47: 0.48, 48: 0.54, 49: 0.60, 50: 0.68,
    51: 0.75, 52: 0.83, 53: 0.91, 54: 1.01, 55: 1.12,
    56: 1.26, 57: 1.42, 58: 1.60, 59: 1.79, 60: 2.01,
    61: 2.25, 62: 2.51, 63: 2.77, 64: 3.06, 65: 3.38,
    66: 3.74, 67: 4.09, 68: 4.48, 69: 4.91, 70: 5.35,
    71: 5.82, 72: 6.31, 73: 6.80, 74: 7.33, 75: 7.89,
    76: 8.52, 77: 9.22, 78: 10.01, 79: 10.88, 80: 11.83,
    81: 14.26, 82: 15.44, 83: 16.66, 84: 17.93, 85: 19.26,
}

# ============================================================
# Page 6 - VIDA INTEIRA CONJUGE (3083) - unissex
# ============================================================
VIDA_INTEIRA_CONJUGE = {
    16: 0.08, 17: 0.09, 18: 0.09, 19: 0.09, 20: 0.10,
    21: 0.10, 22: 0.10, 23: 0.11, 24: 0.11, 25: 0.11,
    26: 0.11, 27: 0.11, 28: 0.12, 29: 0.12, 30: 0.12,
    31: 0.12, 32: 0.13, 33: 0.13, 34: 0.14, 35: 0.15,
    36: 0.15, 37: 0.15, 38: 0.17, 39: 0.18, 40: 0.20,
    41: 0.22, 42: 0.24, 43: 0.26, 44: 0.28, 45: 0.31,
    46: 0.35, 47: 0.39, 48: 0.44, 49: 0.50, 50: 0.56,
    51: 0.61, 52: 0.68, 53: 0.75, 54: 0.83, 55: 0.92,
    56: 1.04, 57: 1.17, 58: 1.32, 59: 1.47, 60: 1.65,
    61: 1.85, 62: 2.07, 63: 2.28, 64: 2.52, 65: 2.78,
    66: 3.08, 67: 3.37, 68: 3.69, 69: 4.04, 70: 4.41,
    71: 4.80, 72: 5.19, 73: 5.60, 74: 6.03, 75: 6.50,
    76: 7.01, 77: 7.59, 78: 8.24, 79: 8.96, 80: 9.74,
    81: 11.74, 82: 12.72, 83: 13.72, 84: 14.77, 85: 15.86,
}

# ============================================================
# Page 7 - PRAZO CERTO (3085) - unissex, periodos 5/10/15/20 anos
# Rows com '-' mapeiam None (idade nao elegivel para periodo)
# ============================================================
PRAZO_CERTO_TABLE = {
    16: {"5_anos": 0.10, "10_anos": 0.12, "15_anos": 0.12, "20_anos": 0.13},
    17: {"5_anos": 0.12, "10_anos": 0.13, "15_anos": 0.13, "20_anos": 0.13},
    18: {"5_anos": 0.14, "10_anos": 0.13, "15_anos": 0.13, "20_anos": 0.14},
    19: {"5_anos": 0.14, "10_anos": 0.14, "15_anos": 0.14, "20_anos": 0.14},
    20: {"5_anos": 0.14, "10_anos": 0.14, "15_anos": 0.14, "20_anos": 0.14},
    21: {"5_anos": 0.14, "10_anos": 0.14, "15_anos": 0.14, "20_anos": 0.15},
    22: {"5_anos": 0.14, "10_anos": 0.13, "15_anos": 0.14, "20_anos": 0.15},
    23: {"5_anos": 0.13, "10_anos": 0.13, "15_anos": 0.14, "20_anos": 0.15},
    24: {"5_anos": 0.13, "10_anos": 0.13, "15_anos": 0.14, "20_anos": 0.16},
    25: {"5_anos": 0.13, "10_anos": 0.13, "15_anos": 0.14, "20_anos": 0.16},
    26: {"5_anos": 0.13, "10_anos": 0.14, "15_anos": 0.15, "20_anos": 0.17},
    27: {"5_anos": 0.13, "10_anos": 0.14, "15_anos": 0.15, "20_anos": 0.17},
    28: {"5_anos": 0.13, "10_anos": 0.14, "15_anos": 0.16, "20_anos": 0.18},
    29: {"5_anos": 0.14, "10_anos": 0.15, "15_anos": 0.16, "20_anos": 0.19},
    30: {"5_anos": 0.14, "10_anos": 0.15, "15_anos": 0.17, "20_anos": 0.20},
    31: {"5_anos": 0.14, "10_anos": 0.16, "15_anos": 0.18, "20_anos": 0.22},
    32: {"5_anos": 0.15, "10_anos": 0.16, "15_anos": 0.19, "20_anos": 0.23},
    33: {"5_anos": 0.15, "10_anos": 0.17, "15_anos": 0.20, "20_anos": 0.25},
    34: {"5_anos": 0.16, "10_anos": 0.18, "15_anos": 0.22, "20_anos": 0.27},
    35: {"5_anos": 0.17, "10_anos": 0.19, "15_anos": 0.23, "20_anos": 0.29},
    36: {"5_anos": 0.18, "10_anos": 0.20, "15_anos": 0.25, "20_anos": 0.32},
    37: {"5_anos": 0.18, "10_anos": 0.22, "15_anos": 0.27, "20_anos": 0.35},
    38: {"5_anos": 0.20, "10_anos": 0.23, "15_anos": 0.29, "20_anos": 0.38},
    39: {"5_anos": 0.21, "10_anos": 0.25, "15_anos": 0.32, "20_anos": 0.41},
    40: {"5_anos": 0.22, "10_anos": 0.27, "15_anos": 0.34, "20_anos": 0.44},
    41: {"5_anos": 0.24, "10_anos": 0.29, "15_anos": 0.38, "20_anos": 0.48},
    42: {"5_anos": 0.26, "10_anos": 0.32, "15_anos": 0.41, "20_anos": 0.53},
    43: {"5_anos": 0.27, "10_anos": 0.35, "15_anos": 0.45, "20_anos": 0.57},
    44: {"5_anos": 0.30, "10_anos": 0.38, "15_anos": 0.49, "20_anos": 0.63},
    45: {"5_anos": 0.32, "10_anos": 0.42, "15_anos": 0.53, "20_anos": 0.68},
    46: {"5_anos": 0.35, "10_anos": 0.46, "15_anos": 0.58, "20_anos": 0.74},
    47: {"5_anos": 0.39, "10_anos": 0.50, "15_anos": 0.64, "20_anos": 0.81},
    48: {"5_anos": 0.43, "10_anos": 0.55, "15_anos": 0.70, "20_anos": 0.87},
    49: {"5_anos": 0.48, "10_anos": 0.60, "15_anos": 0.76, "20_anos": 0.95},
    50: {"5_anos": 0.53, "10_anos": 0.66, "15_anos": 0.83, "20_anos": 1.03},
    51: {"5_anos": 0.58, "10_anos": 0.72, "15_anos": 0.90, "20_anos": None},
    52: {"5_anos": 0.63, "10_anos": 0.79, "15_anos": 0.98, "20_anos": None},
    53: {"5_anos": 0.69, "10_anos": 0.86, "15_anos": 1.06, "20_anos": None},
    54: {"5_anos": 0.75, "10_anos": 0.93, "15_anos": 1.15, "20_anos": None},
    55: {"5_anos": 0.82, "10_anos": 1.02, "15_anos": 1.24, "20_anos": None},
    56: {"5_anos": 0.89, "10_anos": 1.10, "15_anos": None, "20_anos": None},
    57: {"5_anos": 0.97, "10_anos": 1.20, "15_anos": None, "20_anos": None},
    58: {"5_anos": 1.06, "10_anos": 1.29, "15_anos": None, "20_anos": None},
    59: {"5_anos": 1.15, "10_anos": 1.40, "15_anos": None, "20_anos": None},
    60: {"5_anos": 1.25, "10_anos": 1.51, "15_anos": None, "20_anos": None},
    61: {"5_anos": 1.35, "10_anos": None, "15_anos": None, "20_anos": None},
    62: {"5_anos": 1.46, "10_anos": None, "15_anos": None, "20_anos": None},
    63: {"5_anos": 1.57, "10_anos": None, "15_anos": None, "20_anos": None},
    64: {"5_anos": 1.70, "10_anos": None, "15_anos": None, "20_anos": None},
    65: {"5_anos": 1.83, "10_anos": None, "15_anos": None, "20_anos": None},
}


# ============================================================
# Page 8 - MORTE POR ACIDENTE (1501) + PENSAO POR MORTE (3084)
# ============================================================
MORTE_ACIDENTE = [
    (16, 25, 0.18),
    (26, 40, 0.15),
    (41, 85, 0.13),
]

# Pensao por morte: faixas + idade individual 61+, periodos 10/15/20
PENSAO_MORTE_FAIXAS = [
    {"a0": 15, "a1": 30, "10_anos": 16.25, "15_anos": 22.99, "20_anos": 28.94},
    {"a0": 31, "a1": 35, "10_anos": 21.68, "15_anos": 30.67, "20_anos": 38.62},
    {"a0": 36, "a1": 40, "10_anos": 24.50, "15_anos": 34.66, "20_anos": 43.64},
    {"a0": 41, "a1": 45, "10_anos": 38.26, "15_anos": 54.12, "20_anos": 68.15},
    {"a0": 46, "a1": 50, "10_anos": 65.15, "15_anos": 92.16, "20_anos": 116.04},
    {"a0": 51, "a1": 55, "10_anos": 111.08, "15_anos": 157.14, "20_anos": 197.85},
    {"a0": 56, "a1": 60, "10_anos": 194.33, "15_anos": 274.92, "20_anos": 346.15},
]
PENSAO_MORTE_IDADE = {
    61: {"10_anos": 273.62, "15_anos": 387.08, "20_anos": 487.36},
    62: {"10_anos": 305.45, "15_anos": 432.11, "20_anos": 544.06},
    63: {"10_anos": 337.32, "15_anos": 477.20, "20_anos": 600.83},
    64: {"10_anos": 372.48, "15_anos": 526.94, "20_anos": 663.46},
    65: {"10_anos": 411.39, "15_anos": 581.99, "20_anos": 732.77},
    66: {"10_anos": 454.68, "15_anos": 643.23, "20_anos": 809.88},
    67: {"10_anos": 497.87, "15_anos": 704.33, "20_anos": 886.81},
    68: {"10_anos": 545.51, "15_anos": 771.73, "20_anos": 971.67},
    69: {"10_anos": 596.95, "15_anos": 844.50, "20_anos": 1063.29},
    70: {"10_anos": 651.66, "15_anos": 921.89, "20_anos": 1160.74},
    71: {"10_anos": 708.72, "15_anos": 1002.62, "20_anos": 1262.38},
    72: {"10_anos": 767.62, "15_anos": 1085.94, "20_anos": 1367.29},
    73: {"10_anos": 827.96, "15_anos": 1171.30, "20_anos": 1474.76},
    74: {"10_anos": 891.57, "15_anos": 1261.28, "20_anos": 1588.06},
    75: {"10_anos": 960.28, "15_anos": 1358.49, "20_anos": 1710.45},
    76: {"10_anos": 1036.32, "15_anos": 1466.06, "20_anos": 1845.89},
    77: {"10_anos": 1121.66, "15_anos": 1586.79, "20_anos": 1997.89},
    78: {"10_anos": 1217.98, "15_anos": 1723.06, "20_anos": 2169.47},
    79: {"10_anos": 1324.39, "15_anos": 1873.59, "20_anos": 2359.00},
    80: {"10_anos": 1439.44, "15_anos": 2036.34, "20_anos": 2563.92},
    81: {"10_anos": 1735.36, "15_anos": 2454.98, "20_anos": 3091.02},
    82: {"10_anos": 1878.95, "15_anos": 2658.12, "20_anos": 3346.79},
    83: {"10_anos": 2027.42, "15_anos": 2868.15, "20_anos": 3611.23},
    84: {"10_anos": 2181.97, "15_anos": 3086.79, "20_anos": 3886.53},
    85: {"10_anos": 2343.83, "15_anos": 3315.77, "20_anos": 4174.82},
}


# ============================================================
# Page 9 - INVALIDEZ x3 + RENDA POR INVALIDEZ
# ============================================================
INVALIDEZ_MAJORADA = [(16, 65, 0.08)]
INVALIDEZ_MAJORADA_OU_DOENCA_FAIXAS = [
    (16, 25, 0.12),
    (26, 30, 0.13),
    (31, 35, 0.13),
    (36, 40, 0.15),
    (41, 45, 0.20),
    (46, 50, 0.26),
    (51, 55, 0.41),
    (56, 60, 0.69),
]
INVALIDEZ_MAJORADA_OU_DOENCA_IDADES = {
    61: 0.98, 62: 1.10, 63: 1.24, 64: 1.40, 65: 1.58,
}
INVALIDEZ_TOTAL = [(66, 85, 0.07)]

RENDA_INVALIDEZ_RANGES = [
    {"a0": 16, "a1": 30, "20_anos": 14.14, "30_anos": 18.87},
    {"a0": 31, "a1": 35, "20_anos": 15.76, "30_anos": 20.89},
    {"a0": 36, "a1": 40, "20_anos": 18.60, "30_anos": 24.50},
    {"a0": 41, "a1": 45, "20_anos": 24.41, "30_anos": 31.84},
    {"a0": 46, "a1": 50, "20_anos": 35.81, "30_anos": 45.95},
    {"a0": 51, "a1": 55, "20_anos": 57.46, "30_anos": 71.87},
    {"a0": 56, "a1": 60, "20_anos": 97.25, "30_anos": 117.28},
    {"a0": 61, "a1": 65, "20_anos": 167.06, "30_anos": 192.34},
]

# ============================================================
# Page 10 - DOENCAS GRAVES Essencial/Plus/Premium/Master
# ============================================================
DG_ESSENCIAL = [
    (16, 25, 0.16), (26, 30, 0.17), (31, 35, 0.24), (36, 40, 0.30),
    (41, 45, 0.48), (46, 50, 0.66), (51, 55, 0.96), (56, 60, 1.38),
    (61, 65, 1.81),
]
DG_PLUS = [
    (16, 25, 0.22), (26, 30, 0.24), (31, 35, 0.33), (36, 40, 0.43),
    (41, 45, 0.70), (46, 50, 0.98), (51, 55, 1.52), (56, 60, 2.24),
    (61, 65, 3.06),
]
DG_PREMIUM = [
    (16, 25, 0.45), (26, 30, 0.50), (31, 35, 0.59), (36, 40, 0.68),
    (41, 45, 0.98), (46, 50, 1.27), (51, 55, 1.86), (56, 60, 2.62),
    (61, 65, 3.51),
]
# Master: 66+ individual
DG_MASTER = {
    66: 3.53, 67: 3.69, 68: 3.85, 69: 4.06, 70: 4.27,
    71: 4.47, 72: 4.68, 73: 4.88, 74: 5.20, 75: 5.53,
    76: 5.85, 77: 5.89, 78: 6.49, 79: 7.16, 80: 7.89,
    81: 8.68, 82: 9.55, 83: 10.50, 84: 11.51, 85: 12.58,
}


# ============================================================
# Page 13 - DIH (2114/2115/2116) + UTI (2117) + CIRURGIAS (2301)
# ============================================================
DIH_150 = [
    (16, 19, 3.07), (20, 29, 4.74), (30, 39, 6.12), (40, 49, 9.07),
    (50, 59, 11.98), (60, 65, 17.47),
]
DIH_200 = [
    (16, 19, 3.17), (20, 29, 5.06), (30, 39, 6.69), (40, 49, 9.95),
    (50, 59, 13.10), (60, 65, 18.73),
]
DIH_250 = [
    (16, 19, 3.33), (20, 29, 5.52), (30, 39, 7.46), (40, 49, 11.12),
    (50, 59, 14.60), (60, 65, 20.45),
]
UTI = [
    (16, 19, 0.12), (20, 29, 0.19), (30, 39, 0.17), (40, 49, 0.29),
    (50, 59, 0.56), (60, 65, 1.09),
]
CIRURGIAS_RANGES = {
    "M": [
        (16, 25, 14.09), (26, 30, 13.82), (31, 35, 14.83), (36, 40, 15.98),
        (41, 45, 18.83), (46, 50, 23.66), (51, 55, 30.79), (56, 60, 40.94),
        (61, 65, 50.91),
    ],
    "F": [
        (16, 25, 8.09), (26, 30, 12.71), (31, 35, 16.00), (36, 40, 20.31),
        (41, 45, 25.49), (46, 50, 28.56), (51, 55, 28.72), (56, 60, 30.71),
        (61, 65, 34.43),
    ],
}


def parse_saf_page(pdf_path: str, page_num: int, codes: tuple, names: tuple) -> list:
    """Parse SAF table from PDF page. Returns list of rows.
    Layout: '<age> anos <v1> <v2> <v3> <v4>' where v can be '-'.
    """
    import re
    import pdfplumber
    out = []
    with pdfplumber.open(pdf_path) as pdf:
        text = pdf.pages[page_num - 1].extract_text() or ""
    row_re = re.compile(r"^(\d{2})\s+anos\s+(.+)$", re.MULTILINE)
    for m in row_re.finditer(text):
        age = int(m.group(1))
        rest = m.group(2).strip().split()
        # Take first 4 tokens (values)
        if len(rest) < 4:
            continue
        vals = rest[:4]
        for code, name, tok in zip(codes, names, vals):
            if tok == "-":
                continue
            try:
                rate = float(tok.replace(".", "").replace(",", ".")) if "," in tok else float(tok)
            except ValueError:
                continue
            out.extend(unissex(name, code, "BASICA", age=age, period="", rate=rate, page=page_num))
    return out


# ============================================================
# Pages 14-16 - SAF ESSENCIAL/PLUS/PREMIUM (4 planos cada: Individual/Familiar/Familiar+Pais/Familiar+Pais+Sogros)
# Tabelas extraidas via parse_saf_page() em tempo de execucao.
# ============================================================
_UNUSED = {
    # age: (Individual, Familiar, FamPais, FamPaisSogros)
    16: (0.48, 1.43, 4.54, 6.62),
    17: (0.49, 1.45, 4.92, 7.24),
    18: (0.50, 1.47, 5.34, 7.92),
    19: (0.52, 1.49, 5.79, 8.66),
    20: (0.53, 1.51, 6.28, 9.45),
    21: (0.54, 1.53, 6.78, 10.27),
    22: (0.56, 1.56, 7.32, 11.16),
    23: (0.58, 1.41, 7.72, 11.93),
    24: (0.60, 1.35, 8.25, 12.85),
    25: (0.62, 1.31, 8.84, 13.86),
    26: (0.64, 1.30, 9.50, 14.97),
    27: (0.66, 1.31, 10.23, 16.18),
    28: (0.69, 1.33, 11.02, 17.49),
    29: (0.72, 1.37, 11.89, 18.91),
    30: (0.75, 1.42, 12.84, 20.45),
    31: (0.79, 1.49, 13.88, 22.15),
    32: (0.83, 1.56, 15.04, 24.03),
    33: (0.87, 1.64, 16.32, 26.11),
    34: (0.92, 1.73, 17.74, 28.41),
    35: (0.97, 1.83, 19.31, 30.97),
    36: (1.02, 1.93, 21.06, 33.80),
    37: (1.09, 2.05, 22.98, 36.94),
    38: (1.15, 2.18, 25.12, 40.41),
    39: (1.23, 2.32, 27.48, 44.26),
    40: (1.31, 2.47, 30.10, 48.52),
    41: (1.41, 2.65, 33.01, 53.26),
    42: (1.54, 2.88, 36.26, 58.52),
    43: (1.69, 3.14, 39.87, 64.36),
    44: (1.86, 3.45, 43.88, 70.84),
    45: (2.06, 3.79, 48.32, 78.01),
    46: (2.28, 4.18, 53.23, 85.94),
    47: (2.52, 4.60, 58.66, 94.70),
    48: (2.78, 5.07, 64.65, 104.38),
    49: (3.07, 5.57, 71.26, 115.05),
}
SAF_ESSENCIAL_CODES = ("3057", "3058", "3060", "3061")
SAF_PLANOS_NAMES = ("SAF ESSENCIAL INDIVIDUAL", "SAF ESSENCIAL FAMILIAR",
                     "SAF ESSENCIAL FAMILIAR+PAIS", "SAF ESSENCIAL FAMILIAR+PAIS+SOGROS")

# SAF PLUS - R$10.000 (pag 15). Codigos: 3062, 3063, 3064, 3065
SAF_PLUS_TABLE = {
    16: (0.71, 2.44, 8.09, 11.86),
    17: (0.73, 2.47, 8.79, 13.00),
    18: (0.75, 2.50, 9.54, 14.23),
    19: (0.77, 2.54, 10.36, 15.57),
    20: (0.80, 2.58, 11.24, 17.02),
    21: (0.83, 2.63, 12.16, 18.52),
    22: (0.86, 2.67, 13.14, 20.12),
    23: (0.89, 2.41, 13.88, 21.52),
    24: (0.92, 2.29, 14.83, 23.19),
    25: (0.96, 2.23, 15.91, 25.03),
    26: (1.00, 2.20, 17.11, 27.05),
    27: (1.04, 2.21, 18.43, 29.25),
    28: (1.09, 2.25, 19.88, 31.63),
    29: (1.15, 2.32, 21.46, 34.22),
    30: (1.21, 2.41, 23.17, 37.02),
    31: (1.27, 2.54, 25.08, 40.10),
    32: (1.34, 2.67, 27.18, 43.52),
    33: (1.42, 2.82, 29.51, 47.30),
    34: (1.50, 2.98, 32.09, 51.50),
    35: (1.59, 3.16, 34.95, 56.15),
    36: (1.70, 3.35, 38.12, 61.29),
    37: (1.81, 3.56, 41.62, 67.00),
    38: (1.93, 3.80, 45.51, 73.32),
    39: (2.07, 4.05, 49.81, 80.31),
    40: (2.22, 4.33, 54.57, 88.06),
    41: (2.40, 4.66, 59.86, 96.66),
    42: (2.63, 5.07, 65.77, 106.23),
    43: (2.90, 5.55, 72.33, 116.85),
    44: (3.22, 6.11, 79.62, 128.63),
    45: (3.57, 6.73, 87.69, 141.66),
    46: (3.97, 7.43, 96.62, 156.09),
    47: (4.41, 8.20, 106.49, 172.02),
    48: (4.89, 9.05, 117.39, 189.61),
}
SAF_PLUS_CODES = ("3062", "3063", "3064", "3065")
SAF_PLUS_NAMES = ("SAF PLUS INDIVIDUAL", "SAF PLUS FAMILIAR",
                  "SAF PLUS FAMILIAR+PAIS", "SAF PLUS FAMILIAR+PAIS+SOGROS")

# SAF PREMIUM - R$15.000 (pag 16). Codigos: 3066, 3067, 3068, 3069
SAF_PREMIUM_TABLE = {
    16: (0.96, 3.55, 12.04, 17.70),
    17: (0.99, 3.60, 13.08, 19.40),
    18: (1.02, 3.65, 14.21, 21.25),
    19: (1.06, 3.71, 15.44, 23.26),
    20: (1.10, 3.77, 16.77, 25.43),
    21: (1.14, 3.84, 18.14, 27.67),
    22: (1.18, 3.91, 19.61, 30.08),
    23: (1.23, 3.51, 20.71, 32.18),
    24: (1.28, 3.34, 22.15, 34.69),
    25: (1.34, 3.24, 23.77, 37.45),
    26: (1.40, 3.20, 25.57, 40.48),
    27: (1.47, 3.21, 27.55, 43.77),
    28: (1.54, 3.28, 29.72, 47.35),
    29: (1.62, 3.38, 32.09, 51.22),
    30: (1.71, 3.52, 34.66, 55.63),
    31: (1.80, 3.71, 37.51, 60.05),
    32: (1.91, 3.91, 40.67, 65.18),
    33: (2.02, 4.13, 44.17, 70.85),
    34: (2.15, 4.38, 48.04, 77.15),
    35: (2.29, 4.64, 52.33, 84.12),
    36: (2.44, 4.93, 57.08, 91.84),
    37: (2.61, 5.25, 62.34, 100.39),
    38: (2.80, 5.59, 68.16, 109.87),
    39: (3.00, 5.97, 74.61, 120.37),
    40: (3.23, 6.39, 81.75, 131.99),
    41: (3.50, 6.89, 89.69, 144.90),
    42: (3.84, 7.50, 98.55, 159.25),
    43: (4.25, 8.22, 108.40, 175.18),
    44: (4.72, 9.06, 119.33, 192.84),
    45: (5.26, 10.00, 131.44, 212.40),
    46: (5.86, 11.05, 144.84, 234.03),
    47: (6.52, 12.21, 159.64, 257.93),
    48: (7.24, 13.47, 175.98, 284.32),
}
SAF_PREMIUM_CODES = ("3066", "3067", "3068", "3069")
SAF_PREMIUM_NAMES = ("SAF PREMIUM INDIVIDUAL", "SAF PREMIUM FAMILIAR",
                     "SAF PREMIUM FAMILIAR+PAIS", "SAF PREMIUM FAMILIAR+PAIS+SOGROS")


def main() -> int:
    all_rows: list = []

    # Pages 5-6: Vida Inteira + Conjuge
    all_rows.extend(idade_unissex_rows("VIDA INTEIRA", "3082", "BASICA", 5, VIDA_INTEIRA))
    all_rows.extend(idade_unissex_rows("VIDA INTEIRA CONJUGE", "3083", "BASICA", 6, VIDA_INTEIRA_CONJUGE))

    # Page 7: Prazo Certo (multi-periodo)
    all_rows.extend(idade_periods_rows("PRAZO CERTO", "3085", "BASICA", 7, PRAZO_CERTO_TABLE))

    # Page 8: Morte por Acidente + Pensao por Morte
    all_rows.extend(faixa_unissex_rows("MORTE POR ACIDENTE", "1501", "OPCIONAL", 8, MORTE_ACIDENTE))
    all_rows.extend(faixa_periods_rows("PENSAO POR MORTE", "3084", "BASICA", 8,
                                       PENSAO_MORTE_FAIXAS, unit=RATE_UNIT_CAPITAL))
    all_rows.extend(idade_periods_rows("PENSAO POR MORTE", "3084", "BASICA", 8,
                                       PENSAO_MORTE_IDADE, unit=RATE_UNIT_CAPITAL))

    # Page 9: Invalidez x3 + Renda por Invalidez
    all_rows.extend(faixa_unissex_rows("INVALIDEZ POR ACIDENTE MAJORADA", "2278", "OPCIONAL", 9,
                                       INVALIDEZ_MAJORADA))
    all_rows.extend(faixa_unissex_rows("INVALIDEZ POR ACIDENTE MAJORADA OU DOENCA", "2279", "OPCIONAL", 9,
                                       INVALIDEZ_MAJORADA_OU_DOENCA_FAIXAS))
    for age, rate in INVALIDEZ_MAJORADA_OU_DOENCA_IDADES.items():
        all_rows.extend(unissex("INVALIDEZ POR ACIDENTE MAJORADA OU DOENCA", "2279", "OPCIONAL",
                                 age=age, period="", rate=rate, page=9))
    all_rows.extend(faixa_unissex_rows("INVALIDEZ TOTAL POR ACIDENTE", "1548", "OPCIONAL", 9,
                                       INVALIDEZ_TOTAL))
    all_rows.extend(faixa_periods_rows("RENDA POR INVALIDEZ", "2009", "OPCIONAL", 9,
                                       RENDA_INVALIDEZ_RANGES, unit=RATE_UNIT_RENDA))

    # Page 10: Doencas Graves (4 produtos compartilham tabela de idades)
    all_rows.extend(faixa_unissex_rows("DOENCAS GRAVES ESSENCIAL", "2229", "OPCIONAL", 10, DG_ESSENCIAL))
    all_rows.extend(faixa_unissex_rows("DOENCAS GRAVES ESSENCIAL", "2598", "OPCIONAL", 10, DG_ESSENCIAL))
    all_rows.extend(faixa_unissex_rows("DOENCAS GRAVES PLUS", "2230", "OPCIONAL", 10, DG_PLUS))
    all_rows.extend(faixa_unissex_rows("DOENCAS GRAVES PLUS", "2599", "OPCIONAL", 10, DG_PLUS))
    all_rows.extend(faixa_unissex_rows("DOENCAS GRAVES PREMIUM", "2231", "OPCIONAL", 10, DG_PREMIUM))
    for age, rate in DG_MASTER.items():
        all_rows.extend(unissex("DOENCAS GRAVES MASTER", "2345", "OPCIONAL",
                                 age=age, period="", rate=rate, page=10))

    # Page 13: DIH + UTI + Cirurgias
    all_rows.extend(faixa_unissex_rows("DIARIA INTERNACAO HOSPITALAR 150 DIARIAS", "2114", "OPCIONAL", 13,
                                        DIH_150, unit=RATE_UNIT_DIARIA))
    all_rows.extend(faixa_unissex_rows("DIARIA INTERNACAO HOSPITALAR 200 DIARIAS", "2115", "OPCIONAL", 13,
                                        DIH_200, unit=RATE_UNIT_DIARIA))
    all_rows.extend(faixa_unissex_rows("DIARIA INTERNACAO HOSPITALAR 250 DIARIAS", "2116", "OPCIONAL", 13,
                                        DIH_250, unit=RATE_UNIT_DIARIA))
    all_rows.extend(faixa_unissex_rows("DIARIA INTERNACAO HOSPITALAR UTI", "2117", "OPCIONAL", 13,
                                        UTI, unit=RATE_UNIT_DIARIA))
    all_rows.extend(gender_faixas_rows("CIRURGIAS", "2301", "OPCIONAL", 13, CIRURGIAS_RANGES))

    # Pages 14-16: SAF (3 planos de capital, 4 variantes cada) - parsed from PDF
    PDF_PATH = r"C:\tmp\mag_guia_vendas.pdf"
    all_rows.extend(parse_saf_page(PDF_PATH, 14, SAF_ESSENCIAL_CODES, SAF_PLANOS_NAMES))
    all_rows.extend(parse_saf_page(PDF_PATH, 15, SAF_PLUS_CODES, SAF_PLUS_NAMES))
    all_rows.extend(parse_saf_page(PDF_PATH, 16, SAF_PREMIUM_CODES, SAF_PREMIUM_NAMES))

    # Write CSV
    os.makedirs(os.path.dirname(CSV_OUT), exist_ok=True)
    with open(CSV_OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader()
        w.writerows(all_rows)

    print(f"wrote {len(all_rows)} rows to {CSV_OUT}")
    # Summary by product
    from collections import Counter
    c = Counter((r["product_name"], r["product_code"]) for r in all_rows)
    print("\nsummary by (product_name, product_code):")
    for (name, code), cnt in sorted(c.items()):
        print(f"  {cnt:5d}  {code:6s}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
