#!/usr/bin/env python3
"""Rebuild the two README benchmark figures from benchmark-data.json.

Usage: python3 rebuild-benchmarks.py
Dependency: matplotlib (pip install matplotlib).
Source: user-provided MiniCPM-OCR 1.0 PDF, received 2026-10-22;
benchmark summary table on page 6 and throughput chart on page 7.
Conflicting values must remain null until confirmed. Incomplete data blocks plotting.
All paths are relative to this script, so it can run from any directory.
"""

from pathlib import Path
import json
import math



ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "benchmark-data.json").read_text(encoding="utf-8"))

if __name__ == "__main__":
    pending = [
        f"{model['name']} / {axis['name']}"
        for model in DATA["benchmarks"]["models"]
        for axis, score in zip(DATA["benchmarks"]["axes"], model["scores"])
        if score is None
    ]
    pending.extend(
        f"{model['name']} / throughput"
        for model in DATA["throughput"]["models"]
        if model["pages_per_second"] is None
    )
    if pending:
        raise SystemExit("Data pending confirmation; charts were not generated:\n- " + "\n- ".join(pending))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FixedLocator

PURPLE = "#6146D8"
INK = "#252A36"
MUTED = "#697384"
GRID = "#E2E5EC"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 11,
    "text.color": INK,
    "axes.labelcolor": INK,
    "xtick.color": MUTED,
    "ytick.color": MUTED,
    "figure.facecolor": "white",
    "savefig.facecolor": "white",
    "svg.fonttype": "path",
    "svg.hashsalt": "minicpm-ocr-benchmarks-20261022",
})


def save_figure(fig, stem):
    metadata = {
        "Title": stem,
        "Description": DATA["source"]["note"],
        "Date": None,
    }
    fig.savefig(ROOT / f"{stem}.svg", metadata=metadata)
    fig.savefig(ROOT / f"{stem}.png", dpi=180, metadata={"Source": DATA["source"]["note"]})
    plt.close(fig)


def draw_radar():
    source = DATA["benchmarks"]
    count = len(source["axes"])
    angles = [2 * math.pi * index / count for index in range(count)]
    closed_angles = angles + angles[:1]
    fig = plt.figure(figsize=(9.8, 9.0))
    fig.text(0.5, 0.955, "Document parsing and OCR benchmarks", ha="center", fontsize=20, weight="bold")
    fig.text(0.5, 0.917, "Shared 0-100 raw score scale on all six axes", ha="center", color=MUTED, fontsize=11.5)
    ax = fig.add_axes([0.18, 0.23, 0.64, 0.61], projection="polar")
    ax.set_theta_offset(math.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_ylim(0, 100)
    ax.set_yticks([20, 40, 60, 80, 100])
    ax.set_yticklabels(["20", "40", "60", "80", "100"], fontsize=9, color="#929BAB")
    ax.set_rlabel_position(30)
    ax.set_xticks(angles)
    ax.set_xticklabels([])
    for angle, axis in zip(angles, source["axes"]):
        horizontal = "left" if math.sin(angle) > 0.1 else "right" if math.sin(angle) < -0.1 else "center"
        ax.text(angle, 116, axis["label"], color=INK, fontsize=11.5,
                ha=horizontal, va="center", clip_on=False)
    ax.grid(color=GRID, linewidth=0.8)
    ax.spines["polar"].set_color("#C7CCD8")
    ax.spines["polar"].set_linewidth(0.9)
    ax.set_facecolor("#FAFBFD")
    handles = {}
    # Draw the focus model last so its points remain visible where scores overlap.
    for model in source["models"][1:] + source["models"][:1]:
        focus = model["name"] == "MiniCPM-OCR 1.0"
        closed_scores = model["scores"] + model["scores"][:1]
        if focus:
            ax.fill(closed_angles, closed_scores, color=PURPLE, alpha=0.06, zorder=2)
        line, = ax.plot(
            closed_angles, closed_scores, color=model["color"],
            linewidth=2.8 if focus else 1.4,
            marker="o", markersize=5.8 if focus else 3.6,
            markeredgecolor="white", markeredgewidth=0.8 if focus else 0.45,
            alpha=1 if focus else 0.9, zorder=5 if focus else 3,
        )
        handles[model["name"]] = line
    offsets = [(8, 7), (9, 3), (9, -2), (7, -10), (-8, -9), (-8, 7)]
    for angle, score, offset in zip(angles, source["models"][0]["scores"], offsets):
        ax.annotate(
            f"{score:g}", xy=(angle, score), xytext=offset,
            textcoords="offset points", color=PURPLE, weight="bold", fontsize=10,
            ha="left" if offset[0] > 0 else "right", va="center", zorder=6,
            bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.82, "pad": 0.7},
        )
    names = [model["name"] for model in source["models"]]
    legend = fig.legend(
        [handles[name] for name in names], names,
        loc="lower center", bbox_to_anchor=(0.5, 0.083), ncol=3,
        frameon=False, fontsize=10, columnspacing=1.9, handlelength=2.4, labelspacing=1.1,
    )
    legend.get_texts()[0].set_weight("bold")
    legend.get_texts()[0].set_color(PURPLE)
    save_figure(fig, "benchmarks-radar")


def draw_throughput():
    source = DATA["throughput"]
    models = source["models"]
    values = [model["pages_per_second"] for model in models]
    reference = values[0]
    fig = plt.figure(figsize=(12.1, 6.8))
    fig.text(0.07, 0.94, "End-to-end document parsing throughput", fontsize=20, weight="bold")
    fig.text(0.07, 0.893, "OmniDocBench v1.6 (1,651 images)  |  RTX 5090  |  Image concurrency: 1", fontsize=11, color=MUTED)
    ax = fig.add_axes([0.265, 0.235, 0.61, 0.565])
    y_positions = list(range(len(models)))
    ax.axhspan(-0.43, 0.43, color="#F2EFFC", zorder=0)
    ax.barh(y_positions, values, height=0.5, color=[PURPLE] + ["#929CA9"] * (len(models) - 1), zorder=3)
    ax.set_yticks(y_positions)
    ax.set_yticklabels([model["name"] for model in models], fontsize=10.5)
    ax.get_yticklabels()[0].set_weight("bold")
    ax.get_yticklabels()[0].set_color(INK)
    ax.invert_yaxis()
    ax.set_xlim(0, 1.4)
    ax.set_ylim(7.6, -0.6)
    ax.xaxis.set_major_locator(FixedLocator([0, 0.3, 0.6, 0.9, 1.2]))
    ax.set_xticklabels(["0", "0.3", "0.6", "0.9", "1.2"], fontsize=10)
    ax.set_xlabel("Throughput (pages/s; higher is better)", fontsize=10.5, labelpad=12)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8, zorder=1)
    ax.tick_params(axis="both", length=0)
    ax.tick_params(axis="y", pad=15)
    for spine in ax.spines.values():
        spine.set_visible(False)
    for index, value in enumerate(values):
        weight = "bold" if index == 0 else "normal"
        ax.text(value + 0.013, index, f"{value:.3f}", va="center", ha="left", color=INK, fontsize=10.5, weight=weight)
        ax.text(1.075, index, f"{value / reference:.2f}x", transform=ax.get_yaxis_transform(), va="center", ha="center", color=INK if index == 0 else MUTED, fontsize=10.5, weight=weight)
    ax.text(1.075, 1.035, "Relative\nthroughput", transform=ax.transAxes, ha="center", va="bottom", fontsize=9.5, color=MUTED, linespacing=1.4)
    fig.text(0.07, 0.115, "Official SDKs and default configurations. All models use accelerated configurations.", fontsize=9, color=MUTED)
    fig.text(0.07, 0.077, "Relative throughput is normalized to MiniCPM-OCR 1.0 = 1.00x.", fontsize=9, color=MUTED)
    save_figure(fig, "throughput-benchmarks")


if __name__ == "__main__":
    draw_radar()
    draw_throughput()
    print("Rebuilt benchmarks-radar.{svg,png} and throughput-benchmarks.{svg,png}.")
