#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 score.py 的 predictions.jsonl 算 AUROC：整体一个数，再按 category 分列。

AUROC 与阈值无关，衡量的纯粹是排序能力，跨模型、跨版本比较都用它。

用法:
    python evaluate.py --predictions <predictions.jsonl>
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def auroc(pairs: list[tuple[float, int]]) -> float | None:
    """pairs = [(score, label), ...]，label ∈ {0,1}；正负类缺一返回 None。

    走 rank 法（Mann-Whitney U）并对并列分数做平均秩校正。分数以 bf16 前向产出，
    **大量并列是常态**，不做并列校正会把 AUROC 系统性算偏。
    """
    pos = sum(1 for _, label in pairs if label == 1)
    neg = len(pairs) - pos
    if pos == 0 or neg == 0:
        return None
    ordered = sorted(pairs, key=lambda item: item[0])
    ranks = [0.0] * len(ordered)
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and ordered[j + 1][0] == ordered[i][0]:
            j += 1
        average_rank = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[k] = average_rank
        i = j + 1
    rank_sum = sum(rank for rank, (_, label) in zip(ranks, ordered) if label == 1)
    return (rank_sum - pos * (pos + 1) / 2.0) / (pos * neg)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--predictions", required=True, type=Path)
    args = ap.parse_args()

    rows = [json.loads(line) for line in args.predictions.open(encoding="utf-8") if line.strip()]
    labeled = [row for row in rows if row.get("label") in (0, 1)]
    if not labeled:
        raise SystemExit(
            f"[FATAL] {args.predictions} 里一条有效标签都没有（共 {len(rows)} 行）；"
            " 多半是打分时源 jsonl 的 label 没被认出来，查 score.py 的 label_to_int。")
    if len(labeled) != len(rows):
        print(f"[WARN] {len(rows) - len(labeled)} 行无有效标签，已排除")

    pairs = [(float(row["prob_1"]), int(row["label"])) for row in labeled]
    by_category: dict[str, list[tuple[float, int]]] = defaultdict(list)
    for row in labeled:
        by_category[str(row.get("category") or "unknown")].append(
            (float(row["prob_1"]), int(row["label"])))

    positives = sum(1 for _, label in pairs if label == 1)
    print(f"样本数 {len(pairs)}（正例 {positives} / 负例 {len(pairs) - positives}）")
    print(f"\nAUROC 整体   {auroc(pairs):.4f}")
    for name, values in sorted(by_category.items()):
        score = auroc(values)
        print(f"  {name:<10} n={len(values):<6} {'-' if score is None else f'{score:.4f}'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
