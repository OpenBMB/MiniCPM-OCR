#!/usr/bin/env python3
"""Filter OCR RM JSONL rows containing embedded base64 image payloads."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple


BASE64_IMAGE_RE = re.compile(r'data:image/[^;,]+;base64,', re.IGNORECASE)
SIDECAR_SUFFIXES = ('sources', 'metric_categories', 'metric_labels')


def _nonempty_lines(path: Path) -> Iterator[Tuple[int, str]]:
    with path.open(encoding='utf-8') as handle:
        for line_no, line in enumerate(handle):
            if line.strip():
                yield line_no, line


def _json_loads(line: str, path: Path, line_no: int) -> Dict[str, Any]:
    try:
        value = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ValueError(f'Invalid JSON at {path}:{line_no + 1}: {exc}') from exc
    if not isinstance(value, dict):
        raise ValueError(f'Expected JSON object at {path}:{line_no + 1}.')
    return value


def _metric_category_from_source(record: Dict[str, Any]) -> str:
    metric_category = str(record.get('metric_category', '')).strip()
    if metric_category:
        return metric_category
    kind = str(record.get('kind', '')).strip().lower()
    category = str(record.get('category', '')).strip().lower()
    if kind == 'formula' or category in {'formula', '公式 (formula)'}:
        return 'formula'
    if kind == 'table' or category in {'table', '表格 (table)'}:
        return 'table'
    return 'text'


def _sidecar_paths(input_dir: Path, split: str) -> Dict[str, Path]:
    paths = {}
    for suffix in SIDECAR_SUFFIXES:
        path = input_dir / f'{split}_{suffix}.jsonl'
        if path.is_file():
            paths[suffix] = path
    return paths


def _tmp_path(path: Path) -> Path:
    return path.with_suffix(f'{path.suffix}.tmp-{os.getpid()}')


def _next_sidecar_rows(
    sidecar_iters: Dict[str, Iterator[Tuple[int, str]]],
    data_path: Path,
    data_index: int,
) -> Dict[str, Tuple[int, str]]:
    rows = {}
    for name, iterator in sidecar_iters.items():
        try:
            sidecar_index, sidecar_line = next(iterator)
        except StopIteration as exc:
            raise ValueError(f'{name} sidecar has fewer rows than {data_path}.') from exc
        if sidecar_index != data_index:
            raise ValueError(
                f'Paired row positions diverged for {name}: dataset={data_index}, sidecar={sidecar_index}.')
        rows[name] = (sidecar_index, sidecar_line)
    return rows


def _check_sidecars_exhausted(sidecar_iters: Dict[str, Iterator[Tuple[int, str]]], data_path: Path) -> None:
    for name, iterator in sidecar_iters.items():
        try:
            sidecar_index, _ = next(iterator)
        except StopIteration:
            continue
        raise ValueError(f'{name} sidecar has more rows than {data_path}; first extra row={sidecar_index}.')


def _label_from_records(data_record: Dict[str, Any], sidecar_records: Dict[str, Dict[str, Any]]) -> str:
    for record in (data_record, *sidecar_records.values()):
        if 'label' in record:
            return str(record['label'])
    return 'unknown'


def _category_from_records(sidecar_records: Dict[str, Dict[str, Any]]) -> str:
    for key in ('metric_categories', 'metric_labels', 'sources'):
        record = sidecar_records.get(key)
        if record:
            return _metric_category_from_source(record)
    return 'unknown'


def _filter_split(input_dir: Path, output_dir: Path, split: str) -> Dict[str, Any]:
    data_path = input_dir / f'{split}.jsonl'
    if not data_path.is_file():
        raise FileNotFoundError(data_path)

    sidecar_inputs = _sidecar_paths(input_dir, split)
    data_output = output_dir / data_path.name
    data_tmp = _tmp_path(data_output)
    sidecar_outputs = {
        name: output_dir / path.name
        for name, path in sidecar_inputs.items()
    }
    sidecar_temps = {
        name: _tmp_path(path)
        for name, path in sidecar_outputs.items()
    }

    input_labels, kept_labels, dropped_labels = Counter(), Counter(), Counter()
    input_categories, kept_categories, dropped_categories = Counter(), Counter(), Counter()
    dropped_indices: List[int] = []
    dropped_row_ids: List[str] = []
    total = kept = dropped = 0

    sidecar_iters = {name: _nonempty_lines(path) for name, path in sidecar_inputs.items()}
    sidecar_handles = {
        name: path.open('w', encoding='utf-8')
        for name, path in sidecar_temps.items()
    }
    try:
        with data_tmp.open('w', encoding='utf-8') as data_handle:
            for data_index, data_line in _nonempty_lines(data_path):
                sidecar_rows = _next_sidecar_rows(sidecar_iters, data_path, data_index)
                data_record = _json_loads(data_line, data_path, data_index)
                sidecar_records = {
                    name: _json_loads(line, sidecar_inputs[name], line_no)
                    for name, (line_no, line) in sidecar_rows.items()
                }
                label = _label_from_records(data_record, sidecar_records)
                category = _category_from_records(sidecar_records)
                input_labels[label] += 1
                input_categories[category] += 1
                total += 1

                if BASE64_IMAGE_RE.search(data_line):
                    dropped += 1
                    dropped_indices.append(data_index)
                    row_id = sidecar_records.get('sources', {}).get('mixed_row_id')
                    if row_id is not None:
                        dropped_row_ids.append(str(row_id))
                    dropped_labels[label] += 1
                    dropped_categories[category] += 1
                    continue

                kept += 1
                kept_labels[label] += 1
                kept_categories[category] += 1
                data_handle.write(data_line)
                for name, (_, sidecar_line) in sidecar_rows.items():
                    sidecar_handles[name].write(sidecar_line)

            _check_sidecars_exhausted(sidecar_iters, data_path)
    finally:
        for handle in sidecar_handles.values():
            handle.close()

    os.replace(data_tmp, data_output)
    for name, tmp in sidecar_temps.items():
        os.replace(tmp, sidecar_outputs[name])

    return {
        'input_rows': total,
        'kept_rows': kept,
        'dropped_rows': dropped,
        'drop_rule': 'OCR text contains data:image/...;base64,',
        'dropped_original_indices': dropped_indices,
        'dropped_row_ids': dropped_row_ids,
        'input_label_counts': dict(sorted(input_labels.items())),
        'kept_label_counts': dict(sorted(kept_labels.items())),
        'dropped_label_counts': dict(sorted(dropped_labels.items())),
        'input_category_counts': dict(sorted(input_categories.items())),
        'kept_category_counts': dict(sorted(kept_categories.items())),
        'dropped_category_counts': dict(sorted(dropped_categories.items())),
        'dataset': str(data_output),
        'sidecars': {name: str(path) for name, path in sorted(sidecar_outputs.items())},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    parser.add_argument('--splits', nargs='+', default=['train', 'val'])
    args = parser.parse_args()

    if not args.input_dir.is_dir():
        raise NotADirectoryError(args.input_dir)
    if args.input_dir.resolve() == args.output_dir.resolve():
        raise ValueError('--output-dir must be different from --input-dir.')

    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        'input_dir': str(args.input_dir),
        'output_dir': str(args.output_dir),
        'filter': 'OCR text contains data:image/...;base64,',
        'splits': {
            split: _filter_split(args.input_dir, args.output_dir, split)
            for split in args.splits
        },
    }
    (args.output_dir / 'base64_filter_audit.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
        encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
