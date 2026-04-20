"""
Gera relatorio markdown a partir dos resultados em results/<timestamp>/.

Uso:
    python report.py results/20260421_120000
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path


def fmt(v, digits=3):
    if v is None or (isinstance(v, float) and v != v):
        return "—"
    return f"{v:.{digits}f}"


def load(run_dir: Path):
    raw = [json.loads(l) for l in (run_dir / "raw.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    per_q_path = run_dir / "ragas_per_question.csv"
    scores_path = run_dir / "ragas_scores.json"

    per_q = []
    if per_q_path.exists():
        import csv
        with per_q_path.open(encoding="utf-8") as f:
            per_q = list(csv.DictReader(f))

    scores = {}
    if scores_path.exists():
        scores = json.loads(scores_path.read_text(encoding="utf-8"))

    return raw, per_q, scores


def build_report(run_dir: Path) -> str:
    raw, per_q, scores = load(run_dir)
    total = len(raw)
    ok = [r for r in raw if r["response"]["ok"]]
    failed = [r for r in raw if not r["response"]["ok"]]

    # Index ragas por id
    per_q_by_id = {row["id"]: row for row in per_q}

    # Agrupa por categoria
    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in raw:
        by_cat[r["category"]].append(r)

    lines: list[str] = []
    lines.append(f"# SOLOMON Ragas Eval — {run_dir.name}\n")
    lines.append(f"- Total de perguntas: **{total}**")
    lines.append(f"- Respostas OK: **{len(ok)}**")
    lines.append(f"- Falhas HTTP: **{len(failed)}**")
    if ok:
        lats = [r["response"]["data"].get("latencyMs", 0) for r in ok]
        lines.append(f"- Latencia (ms): min={min(lats)} / mediana={int(statistics.median(lats))} / max={max(lats)}")

    # Scores agregados
    if scores:
        lines.append("\n## Scores agregados (Ragas)\n")
        for metric, value in scores.items():
            try:
                v = float(value)
                interp = ""
                if metric == "faithfulness":
                    interp = " (mede se resposta e grounded no contexto — mais alto = menos alucinacao)"
                elif metric == "answer_correctness":
                    interp = " (mede similaridade com ground truth — mais alto = mais correto)"
                elif metric == "context_precision":
                    interp = " (mede se chunks recuperados sao relevantes — mais alto = retrieval bom)"
                lines.append(f"- **{metric}**: {fmt(v)}{interp}")
            except Exception:
                lines.append(f"- **{metric}**: {value}")

    # Breakdown por categoria
    lines.append("\n## Breakdown por categoria\n")
    lines.append("| Categoria | N | OK | Faithfulness | Answer Correctness | Context Precision |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for cat, items in sorted(by_cat.items()):
        ok_items = [r for r in items if r["response"]["ok"]]
        f_scores, c_scores, p_scores = [], [], []
        for r in ok_items:
            row = per_q_by_id.get(r["id"])
            if not row:
                continue
            try:
                if row.get("faithfulness"): f_scores.append(float(row["faithfulness"]))
                if row.get("answer_correctness"): c_scores.append(float(row["answer_correctness"]))
                if row.get("context_precision"): p_scores.append(float(row["context_precision"]))
            except ValueError:
                pass
        f_avg = sum(f_scores)/len(f_scores) if f_scores else None
        c_avg = sum(c_scores)/len(c_scores) if c_scores else None
        p_avg = sum(p_scores)/len(p_scores) if p_scores else None
        lines.append(f"| {cat} | {len(items)} | {len(ok_items)} | {fmt(f_avg)} | {fmt(c_avg)} | {fmt(p_avg)} |")

    # Model distribution
    lines.append("\n## Modelos roteados\n")
    model_count: dict[str, int] = defaultdict(int)
    for r in ok:
        m = r["response"]["data"].get("model", "?")
        model_count[m] += 1
    lines.append("| Model | Count |")
    lines.append("|---|---:|")
    for m, n in sorted(model_count.items(), key=lambda x: -x[1]):
        lines.append(f"| {m} | {n} |")

    # Drift vs expected_model
    lines.append("\n## Expected vs actual model\n")
    lines.append("| ID | Category | Expected | Actual | Match |")
    lines.append("|---|---|---|---|---|")
    mismatches = []
    for r in ok:
        expected = r.get("expected_model") or "?"
        actual = r["response"]["data"].get("model", "?")
        match = "✓" if expected == actual else "✗"
        if expected != actual:
            mismatches.append((r["id"], expected, actual))
        lines.append(f"| {r['id']} | {r['category']} | {expected} | {actual} | {match} |")

    # Perguntas com pior score (alerta humano)
    if per_q:
        lines.append("\n## Piores respostas (faithfulness < 0.6 OU answer_correctness < 0.5)\n")
        lines.append("| ID | Category | Faithfulness | Correctness | Question |")
        lines.append("|---|---|---:|---:|---|")
        for row in per_q:
            try:
                f = float(row.get("faithfulness") or 1)
                c = float(row.get("answer_correctness") or 1)
            except ValueError:
                continue
            if f < 0.6 or c < 0.5:
                qtext = (row.get("question") or "")[:90].replace("|", "\\|")
                lines.append(f"| {row.get('id')} | {row.get('category')} | {fmt(f)} | {fmt(c)} | {qtext} |")

    # Falhas HTTP
    if failed:
        lines.append("\n## Falhas HTTP\n")
        for r in failed:
            err = r["response"].get("error", "")[:200].replace("\n", " ")
            lines.append(f"- **{r['id']}** ({r['category']}): status={r['response']['status']} — {err}")

    # Perguntas flagged para review humana (Julio)
    needs_review = [r for r in ok if r.get("needs_julio_review")]
    if needs_review:
        lines.append(f"\n## Flag Julio ({len(needs_review)} perguntas com GT que precisam de validacao do corretor)\n")
        for r in needs_review:
            lines.append(f"- **{r['id']}** ({r['category']}): {r['question'][:120]}")

    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python report.py results/<timestamp>")
        return 1
    run_dir = Path(sys.argv[1])
    if not run_dir.exists():
        print(f"Diretorio nao existe: {run_dir}")
        return 1
    md = build_report(run_dir)
    out = run_dir / "REPORT.md"
    out.write_text(md, encoding="utf-8")
    print(f"Report gerado: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
