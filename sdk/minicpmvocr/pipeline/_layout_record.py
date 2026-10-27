from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List

from PIL import Image

from ._inputs import _open_page_image
from ..backends import PNG_COMPRESS_LEVEL
from .._utils import ensure_dir, write_json


def _to_polygon_points(raw_points) -> List[List[int]]:
    out = []
    for point in raw_points:
        if isinstance(point, (list, tuple)):
            x, y = point[0], point[1]
        else:
            x, y = point.tolist()
        out.append([int(x), int(y)])
    return out

def _build_layout_from_blocks(
    *,
    image: Image.Image,
    image_id: str,
    source_path: str,
    source_type: str,
    page_index: int | None,
    detections: List[Dict],
    blocks: List[Dict],
    crops_root: Path,
    crop_sink: Dict | None = None,
) -> tuple[Dict, Dict]:

    crop_dir = crops_root / image_id
    if crop_sink is None:
        ensure_dir(crop_dir)

    layout_blocks = []
    png_save_sec = 0.0


    folded_by_leader: Dict[int, List[List[int]]] = {}
    leader_index: Dict[int, int] = {}
    last_leader: int | None = None
    for index, block in enumerate(blocks):
        if block.get("image") is not None:
            last_leader = index
            leader_index[index] = index
            continue


        group_id = block.get("group_id")
        leader = group_id if group_id in leader_index else last_leader
        if leader is None:
            continue
        folded_by_leader.setdefault(leader, []).append(
            [int(v) for v in block["bbox"]]
        )


    for order, block in enumerate(blocks):
        crop_image = block.get("image")
        if crop_image is None:
            continue
        label = block["label"]
        x1, y1, x2, y2 = (int(v) for v in block["bbox"])
        crop_filename = f"{order:03d}_{label}.png"
        if crop_sink is not None:
            crop_sink[crop_filename] = crop_image
        else:
            t_save = time.time()


            Image.fromarray(crop_image).save(crop_dir / crop_filename, compress_level=PNG_COMPRESS_LEVEL)
            png_save_sec += time.time() - t_save


        regions = [[x1, y1, x2, y2]] + folded_by_leader.get(order, [])
        layout_blocks.append(
            {
                "block_id": order,
                "label": label,
                "bbox": [x1, y1, x2, y2],


                "regions": regions,
                "order": order,
                "score": round(float(block.get("score", 0.0) or 0.0), 6),
                "crop_filename": crop_filename,
                "crop_width": int(crop_image.shape[1]),
                "crop_height": int(crop_image.shape[0]),
                "skip_vlm": bool(block.get("skip_vlm", False)),
            }
        )

    layout = {
        "image_id": image_id,
        "image_width": image.width,
        "image_height": image.height,
        "num_blocks": len(layout_blocks),
        "png_save_sec": round(png_save_sec, 6),
        "blocks": layout_blocks,
        "source": {
            "type": source_type,
            "path": source_path,
            "relative_path": Path(source_path).name,
            "raw_image_id": image_id,
            "original_stem": Path(source_path).stem,
            "page_index": page_index,
        },
    }

    raw = {
        "input_path": source_path,
        "page_index": page_index,
        "boxes": [
            {
                "order": idx + 1,
                "cls_id": int(detection["class_id"]),
                "label": detection["label"],
                "score": round(float(detection["score"]), 6),
                "coordinate": [round(float(v), 2) for v in detection["bbox"]],
                "polygon_points": _to_polygon_points(detection.get("polygon") or []),
            }
            for idx, detection in enumerate(detections)
        ],
    }
    return layout, raw

def _parse_one_page(
    cfg: Dict, layout_detector, entry: Dict, runtime_intermediate: Path, crop_sink: Dict | None = None, upright_corrector=None,
    page_image=None, upright_ready=None, clock_start: float | None = None,
) -> Dict:

    image_id = entry["image_id"]
    page_t0 = time.time()
    layouts_dir = runtime_intermediate / "layouts"
    raw_result_dir = runtime_intermediate / "layout_raw"
    crops_root = runtime_intermediate / "crops"
    upright_dir = runtime_intermediate / "upright"
    pages_dir = runtime_intermediate / "pages"
    save_pages = bool((cfg.get("pipeline") or {}).get("save_pages", False))

    phase = {
        "image_load_sec": 0.0,
        "upright_sec": 0.0,
        "detect_sec": 0.0,
        "crop_sec": 0.0,
        "page_save_sec": 0.0,
        "write_sec": 0.0,
    }
    try:
        t0 = time.time()
        image = page_image if page_image is not None else _open_page_image(entry)
        phase["image_load_sec"] = 0.0 if page_image is not None else time.time() - t0


        upright_record = None
        if upright_ready is not None:
            corrected_array, upright_record, upright_sec = upright_ready
            phase["upright_sec"] = float(upright_sec)
            if upright_record.get("applied", False):
                image.close()
                image = Image.fromarray(corrected_array)
            if upright_record:
                ensure_dir(upright_dir)
                write_json(upright_dir / f"{image_id}.json", upright_record)
        elif upright_corrector is not None:
            t0 = time.time()
            import numpy as np
            image_array = np.array(image)
            corrected_array, upright_record = upright_corrector.correct(image_array)
            if upright_record.get("applied", False):
                image.close()
                image = Image.fromarray(corrected_array)
            phase["upright_sec"] = time.time() - t0

            if upright_record:
                ensure_dir(upright_dir)
                write_json(upright_dir / f"{image_id}.json", upright_record)

        t0 = time.time()
        detections = layout_detector.detect([image])[0]
        phase["detect_sec"] = time.time() - t0

        t0 = time.time()
        blocks = layout_detector.crop(image, detections)
        phase["crop_sec"] = time.time() - t0


        page_image_rel = ""
        if save_pages:
            t0 = time.time()
            ensure_dir(pages_dir)
            page_image_rel = f"pages/{image_id}.png"
            image.save(pages_dir / f"{image_id}.png", compress_level=PNG_COMPRESS_LEVEL)
            phase["page_save_sec"] = time.time() - t0

        t0 = time.time()
        layout, raw = _build_layout_from_blocks(
            image=image,
            image_id=image_id,
            source_path=entry["source_path"],
            source_type=entry["source_type"],
            page_index=entry["page_index"],
            detections=detections,
            blocks=blocks,
            crops_root=crops_root,
            crop_sink=crop_sink,
        )
        if page_image_rel:
            layout["page_image"] = page_image_rel
        if upright_record is not None:
            layout["upright"] = upright_record


        phase["png_save_sec"] = float(layout.get("png_save_sec", 0.0))
        write_json(layouts_dir / f"{image_id}.json", layout)
        write_json(raw_result_dir / f"{image_id}.json", raw)
        phase["write_sec"] = time.time() - t0 - phase["png_save_sec"]
        image.close()

        return {
            "image_id": image_id,
            "status": "ok",
            "source_path": entry["source_path"],
            "page_index": entry["page_index"],
            "num_blocks": layout["num_blocks"],
            "duration_sec": round(time.time() - (clock_start if clock_start is not None else page_t0), 6),
            **{k: round(v, 6) for k, v in phase.items()},
        }
    except Exception as e:
        return {
            "image_id": image_id,
            "status": "failed",
            "source_path": entry["source_path"],
            "page_index": entry["page_index"],
            "num_blocks": 0,
            "duration_sec": round(time.time() - (clock_start if clock_start is not None else page_t0), 6),
            **{k: round(v, 6) for k, v in phase.items()},
            "error": str(e),
        }
