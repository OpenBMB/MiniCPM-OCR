from __future__ import annotations

import time
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image

from .base import BaseLayoutDetector, LayoutError, polygon_to_list


from ..constants import (  # noqa: E402
    LAYOUT_SHAPE_MODE,
    MERGE_BBOXES_MODE,
    NON_MERGE_LABELS,
    PX_LABELS,
)


def _sigmoid_np(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, -50, 50)
    return 1.0 / (1.0 + np.exp(-x))


def _get_order_np(order_logits: np.ndarray) -> np.ndarray:

    if order_logits.ndim != 2 or order_logits.shape[0] != order_logits.shape[1]:
        raise ValueError(f"order_logits must be (N, N), got {order_logits.shape}")


    os_np = _sigmoid_np(order_logits.astype(np.float32)).astype(np.float32)
    N = order_logits.shape[0]
    upper = np.triu(os_np, 1)
    lower = np.tril(np.float32(1.0) - os_np.T, -1)


    votes = upper.sum(axis=0, dtype=np.float32) + lower.sum(axis=0, dtype=np.float32)
    ptrs = np.argsort(votes)
    seq = np.zeros(N, dtype=int)
    seq[ptrs] = np.arange(N)
    return seq


def _postprocess_7col(
    logits: np.ndarray,
    pred_boxes: np.ndarray,
    order_logits: np.ndarray,
    img_w: int,
    img_h: int,
    topk: int = 300,
) -> np.ndarray:

    num_queries, num_classes = logits.shape

    scores_flat = _sigmoid_np(logits).flatten()
    top_idx = np.argpartition(-scores_flat, min(topk, len(scores_flat)))[:topk]
    top_scores = scores_flat[top_idx]

    sort_idx = np.argsort(-top_scores)
    top_idx = top_idx[sort_idx]
    top_scores = top_scores[sort_idx]

    labels = (top_idx % num_classes).astype(np.float32)
    qidx = top_idx // num_classes


    cxcy = pred_boxes[:, :2]
    wh = pred_boxes[:, 2:]
    xyxy = np.concatenate([cxcy - 0.5 * wh, cxcy + 0.5 * wh], axis=-1)
    out_shape = np.array([img_w, img_h, img_w, img_h], dtype=np.float32)
    xyxy_scaled = xyxy * out_shape
    top_boxes = xyxy_scaled[qidx]


    seq = _get_order_np(order_logits)
    order_col = seq[qidx].astype(np.float32)


    return np.column_stack([
        labels, top_scores,
        top_boxes[:, 0], top_boxes[:, 1], top_boxes[:, 2], top_boxes[:, 3],
        order_col,
    ])


def _iou_np(b1: np.ndarray, b2: np.ndarray) -> float:
    xi1 = max(b1[2], b2[2]); yi1 = max(b1[3], b2[3])
    xi2 = min(b1[4], b2[4]); yi2 = min(b1[5], b2[5])
    iw = xi2 - xi1 + 1; ih = yi2 - yi1 + 1
    if iw <= 0 or ih <= 0:
        return 0.0
    ia = iw * ih
    a1 = (b1[4] - b1[2] + 1) * (b1[5] - b1[3] + 1)
    a2 = (b2[4] - b2[2] + 1) * (b2[5] - b2[3] + 1)
    return float(ia / (a1 + a2 - ia))


def _nms_np(boxes: np.ndarray, iou_same: float = 0.6, iou_diff: float = 0.95) -> List[int]:
    idx = np.argsort(-boxes[:, 1])
    sel: List[int] = []
    rem = list(idx)
    while rem:
        c = rem[0]
        sel.append(c)
        cb = boxes[c]
        rem = rem[1:]
        nr = []
        for r in rem:
            rb = boxes[r]
            t = iou_diff if cb[0] != rb[0] else iou_same
            if _iou_np(cb, rb) < t:
                nr.append(r)
        rem = nr
    return sel


def _is_contained_np(b1: np.ndarray, b2: np.ndarray) -> bool:

    ix1 = max(b1[2], b2[2]); iy1 = max(b1[3], b2[3])
    ix2 = min(b1[4], b2[4]); iy2 = min(b1[5], b2[5])
    iw = max(0, ix2 - ix1); ih = max(0, iy2 - iy1)
    ia = iw * ih
    a1 = (b1[4] - b1[2]) * (b1[5] - b1[3])
    return bool(ia / a1 >= 0.9) if a1 > 0 else False


def _check_containment_np(
    boxes: np.ndarray,
    formula_idx: Optional[int] = None,
    cat_idx: Optional[int] = None,
    mode: Optional[str] = None,
) -> Tuple[np.ndarray, np.ndarray]:

    n = len(boxes)
    co = np.zeros(n, dtype=int)
    cb_ = np.zeros(n, dtype=int)
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            if formula_idx is not None and boxes[i][0] == formula_idx and boxes[j][0] != formula_idx:
                continue
            if cat_idx is not None and mode:
                if mode == "large" and boxes[j][0] == cat_idx:
                    if _is_contained_np(boxes[i], boxes[j]):
                        cb_[i] = 1; co[j] = 1
                elif mode == "small" and boxes[i][0] == cat_idx:
                    if _is_contained_np(boxes[i], boxes[j]):
                        cb_[i] = 1; co[j] = 1
            else:
                if _is_contained_np(boxes[i], boxes[j]):
                    cb_[i] = 1; co[j] = 1
    return co, cb_


def _layout_analysis_postprocess(
    boxes_7col: np.ndarray,
    img_w: int,
    img_h: int,
    labels: List[str],
    threshold: float = 0.3,
    do_nms: bool = True,
    merge_bboxes_mode: Optional[dict] = None,
) -> List[Dict]:

    boxes = boxes_7col.copy()
    boxes[:, 2:6] = np.round(boxes[:, 2:6]).astype(int)


    keep = (boxes[:, 1] > threshold) & (boxes[:, 0] > -1)
    boxes = boxes[keep]
    if len(boxes) == 0:
        return []


    if do_nms:
        sel = _nms_np(boxes[:, :6], iou_same=0.6, iou_diff=0.98)
        boxes = boxes[sel]
        if len(boxes) == 0:
            return []


    if len(boxes) > 1:
        img_idx = labels.index("image") if "image" in labels else None
        img_area = img_w * img_h
        area_thres = 0.82 if img_w > img_h else 0.93
        filtered = []
        for b in boxes:
            if b[0] == img_idx:
                x1 = int(max(0, b[2])); y1 = int(max(0, b[3]))
                x2 = int(min(img_w, b[4])); y2 = int(min(img_h, b[5]))
                ba = (x2 - x1) * (y2 - y1)
                if ba <= area_thres * img_area:
                    filtered.append(b)
            else:
                filtered.append(b)
        if filtered:
            boxes = np.array(filtered, dtype=boxes.dtype)
        if len(boxes) == 0:
            return []


    if merge_bboxes_mode and len(boxes) >= 2:
        formula_idx = labels.index("formula") if "formula" in labels else None
        if isinstance(merge_bboxes_mode, str):
            if merge_bboxes_mode != "union":
                co, cb = _check_containment_np(boxes[:, :6], formula_idx)
                if merge_bboxes_mode == "large":
                    boxes = boxes[cb == 0]
                elif merge_bboxes_mode == "small":
                    boxes = boxes[(co == 0) | (cb == 1)]
        elif isinstance(merge_bboxes_mode, dict):
            keep_mask = np.ones(len(boxes), dtype=bool)
            for cat_idx, layout_mode in merge_bboxes_mode.items():
                if layout_mode == "union":
                    continue
                co, cb = _check_containment_np(boxes[:, :6], formula_idx, cat_idx, layout_mode)
                if layout_mode == "large":
                    keep_mask &= (cb == 0)
                elif layout_mode == "small":
                    keep_mask &= (co == 0) | (cb == 1)
            boxes = boxes[keep_mask]
        if len(boxes) == 0:
            return []


    sorted_idx = np.argsort(boxes[:, 6])
    boxes = boxes[sorted_idx, :6]


    result: List[Dict] = []
    for b in boxes:
        xmin = int(max(0, b[2]))
        ymin = int(max(0, b[3]))
        xmax = int(min(img_w, b[4]))
        ymax = int(min(img_h, b[5]))
        if xmax <= xmin or ymax <= ymin:
            continue
        result.append({
            "cls_id": int(b[0]),
            "label": labels[int(b[0])],
            "score": float(b[1]),
            "coordinate": [xmin, ymin, xmax, ymax],
        })
    return result


try:
    from shapely.geometry import Polygon
    from shapely.validation import make_valid
    _HAS_SHAPELY = True
except ImportError:
    _HAS_SHAPELY = False


def _bbox_area(bbox: List[float]) -> float:
    return max(0.0, float(bbox[2] - bbox[0]) * float(bbox[3] - bbox[1]))


def _box_overlap_ratio(b1: List[float], b2: List[float], mode: str = "union") -> float:
    x1, y1, x2, y2 = max(b1[0], b2[0]), max(b1[1], b2[1]), min(b1[2], b2[2]), min(b1[3], b2[3])
    iw, ih = max(0.0, x2 - x1), max(0.0, y2 - y1)
    iarea = iw * ih
    a1, a2 = _bbox_area(b1), _bbox_area(b2)
    if mode == "union":
        ref = a1 + a2 - iarea
    elif mode == "small":
        ref = min(a1, a2)
    else:
        ref = max(a1, a2)
    return float(iarea / ref) if ref > 0 else 0.0


def _polygon_overlap_ratio(poly1, poly2, mode: str = "small") -> float:
    if not _HAS_SHAPELY or not poly1 or not poly2:
        return 0.0
    try:
        p1 = make_valid(Polygon(poly1))
        p2 = make_valid(Polygon(poly2))
        inter = p1.intersection(p2).area
        if mode == "union":
            ref = p1.union(p2).area
        elif mode == "small":
            ref = min(p1.area, p2.area)
        else:
            ref = max(p1.area, p2.area)
        return float(inter / ref) if ref > 0 else 0.0
    except Exception:
        return 0.0


def _compute_pairwise_overlap(coords: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    x1, y1, x2, y2 = coords[:, 0], coords[:, 1], coords[:, 2], coords[:, 3]
    areas = np.abs((x2 - x1) * (y2 - y1))
    ix1 = np.maximum(x1[:, None], x1[None, :])
    iy1 = np.maximum(y1[:, None], y1[None, :])
    ix2 = np.minimum(x2[:, None], x2[None, :])
    iy2 = np.minimum(y2[:, None], y2[None, :])
    iw = np.maximum(0, ix2 - ix1)
    ih = np.maximum(0, iy2 - iy1)
    ia = iw * ih
    sa = np.minimum(areas[:, None], areas[None, :])
    with np.errstate(divide="ignore", invalid="ignore"):
        overlap = np.where(sa > 0, ia / sa, 0.0)
    return overlap, areas


def _filter_overlap_boxes(
    boxes: List[Dict], layout_shape_mode: str = "auto"
) -> List[Dict]:

    boxes = [b for b in boxes if b.get("label") != "reference"]
    if not boxes:
        return boxes

    coords = np.array([b["coordinate"] for b in boxes], dtype=np.float64)
    widths = coords[:, 2] - coords[:, 0]
    heights = coords[:, 3] - coords[:, 1]
    overlap_matrix, areas = _compute_pairwise_overlap(coords)

    dropped = set()
    for i in range(len(boxes)):
        if widths[i] < 6 or heights[i] < 6:
            dropped.add(i)
            continue
        for j in range(i + 1, len(boxes)):
            if i in dropped or j in dropped:
                continue
            ratio = overlap_matrix[i, j]
            li = boxes[i]["label"]
            lj = boxes[j]["label"]
            if li == "inline_formula" or lj == "inline_formula":
                if ratio > 0.5:
                    if li == "inline_formula":
                        dropped.add(i)
                    if lj == "inline_formula":
                        dropped.add(j)
                    continue
            if ratio > 0.7:
                if (
                    layout_shape_mode != "rect"
                    and "polygon_points" in boxes[i]
                    and boxes[i]["polygon_points"] is not None
                    and len(boxes[i]["polygon_points"]) > 0
                ):
                    pr = _polygon_overlap_ratio(
                        boxes[i]["polygon_points"],
                        boxes[j]["polygon_points"],
                        "small",
                    )
                    if pr > 0.9:
                        if areas[i] >= areas[j]:
                            dropped.add(j)
                        else:
                            dropped.add(i)
                else:
                    if areas[i] >= areas[j]:
                        dropped.add(j)
                    else:
                        dropped.add(i)
    return [b for idx, b in enumerate(boxes) if idx not in dropped]


def _crop_by_boxes(
    img_rgb: np.ndarray, boxes: List[dict], layout_shape_mode: str = "auto"
) -> List[dict]:

    import cv2

    output: List[dict] = []
    for box_info in boxes:
        box = box_info["coordinate"]
        label = box_info.get("label", str(box_info.get("cls_id", -1)))
        xmin, ymin, xmax, ymax = [int(i) for i in box]
        img_crop = img_rgb[ymin:ymax, xmin:xmax].copy()
        out_info = {"img": img_crop, "box": box, "label": label}
        if layout_shape_mode != "rect" and "polygon_points" in box_info:
            polygon = np.array(box_info["polygon_points"], dtype=np.int32)
            polygon = polygon.reshape((-1, 1, 2))
            if polygon is not None and len(polygon) > 0:
                polygon = polygon - np.array([xmin, ymin])
            mask = np.zeros(img_crop.shape[:2], dtype=np.int32)
            cv2.fillPoly(mask, [polygon], 1)
            img_crop[~mask.astype(bool)] = 255
            out_info["img"] = img_crop
            out_info["polygon_points"] = box_info["polygon_points"]
        output.append(out_info)
    return output


def _calculate_overlap_ratio(
    bbox1: np.ndarray | list | tuple,
    bbox2: np.ndarray | list | tuple,
    mode: str = "union",
) -> float:
    bbox1 = np.array(bbox1, dtype=np.float64)
    bbox2 = np.array(bbox2, dtype=np.float64)
    x_min_inter = max(bbox1[0], bbox2[0])
    y_min_inter = max(bbox1[1], bbox2[1])
    x_max_inter = min(bbox1[2], bbox2[2])
    y_max_inter = min(bbox1[3], bbox2[3])
    iw = max(0.0, x_max_inter - x_min_inter)
    ih = max(0.0, y_max_inter - y_min_inter)
    ia = iw * ih
    a1 = _bbox_area(bbox1.tolist())
    a2 = _bbox_area(bbox2.tolist())
    if mode == "union":
        ref = a1 + a2 - ia
    elif mode == "small":
        ref = min(a1, a2)
    else:
        ref = max(a1, a2)
    return float(ia / ref) if ref > 0 else 0.0


def _calculate_projection_overlap_ratio(
    bbox1: List[float], bbox2: List[float],
    direction: str = "horizontal", mode: str = "union",
) -> float:
    si, ei = (0, 2) if direction == "horizontal" else (1, 3)
    overlap = min(bbox1[ei], bbox2[ei]) - max(bbox1[si], bbox2[si])
    if overlap <= 0:
        return 0.0
    if mode == "union":
        ref_w = max(bbox1[ei], bbox2[ei]) - min(bbox1[si], bbox2[si])
    elif mode == "small":
        ref_w = min(bbox1[ei] - bbox1[si], bbox2[ei] - bbox2[si])
    else:
        ref_w = max(bbox1[ei] - bbox1[si], bbox2[ei] - bbox2[si])
    return float(overlap / ref_w) if ref_w > 0 else 0.0


def _merge_blocks(
    blocks: List[dict], non_merge_labels: List[str],
    layout_shape_mode: str = "auto",
) -> List[dict]:

    if not blocks:
        return blocks

    blocks_to_merge: List[Tuple[int, dict]] = []
    non_merge_blocks: Dict[int, dict] = {}
    for idx, block in enumerate(blocks):
        if block["label"] in non_merge_labels:
            non_merge_blocks[idx] = block
        else:
            blocks_to_merge.append((idx, block))

    merged_groups: List[Tuple[List[int], List[str]]] = []
    current_group: List[dict] = []
    current_indices: List[int] = []
    current_aligns: List[str] = []

    def _is_aligned(a1, a2):
        return abs(a1 - a2) <= 5

    def _get_alignment(bbox, prev_bbox):
        if _is_aligned(bbox[0], prev_bbox[0]):
            return "left"
        elif _is_aligned(bbox[2], prev_bbox[2]):
            return "right"
        return "center"

    def _overlapwith_other_box(bi, pi, blks_list):
        pi_bbox = blks_list[pi]["box"]
        bi_bbox = blks_list[bi]["box"]
        min_box = [
            min(pi_bbox[0], bi_bbox[0]), min(pi_bbox[1], bi_bbox[1]),
            max(pi_bbox[2], bi_bbox[2]), max(pi_bbox[3], bi_bbox[3]),
        ]
        for oi, ob in enumerate(blks_list):
            if oi in (bi, pi) or ob["label"] not in non_merge_labels:
                continue
            if _calculate_overlap_ratio(min_box, ob["box"]) > 0:
                return True
        return False

    for i, (idx, block) in enumerate(blocks_to_merge):
        if not current_group:
            current_group = [block]
            current_indices = [idx]
            current_aligns = []
            continue
        prev_idx, prev_block = blocks_to_merge[i - 1]
        prev_bbox = prev_block["box"]
        prev_label = prev_block["label"]
        block_bbox = block["box"]
        block_label = block["label"]

        iou_h = _calculate_projection_overlap_ratio(block_bbox, prev_bbox, "horizontal")
        is_cross = (
            iou_h == 0
            and block_label == "text"
            and block_label == prev_label
            and block_bbox[0] > prev_bbox[2]
            and block_bbox[1] < prev_bbox[3]
            and (block_bbox[0] - prev_bbox[2])
            < max(prev_bbox[2] - prev_bbox[0], block_bbox[2] - block_bbox[0]) * 0.3
        )
        is_updown_align = (
            iou_h > 0
            and block_label in ["text", "vertical_text"]
            and block_label == prev_label
            and block_bbox[3] >= prev_bbox[1]
            and abs(block_bbox[1] - prev_bbox[3])
            < max(prev_bbox[3] - prev_bbox[1], block_bbox[3] - block_bbox[1]) * 0.5
            and (_is_aligned(block_bbox[0], prev_bbox[0]) ^ _is_aligned(block_bbox[2], prev_bbox[2]))
            and _overlapwith_other_box(idx, prev_idx, blocks)
        )
        if is_cross:
            align_mode = "center"
        elif is_updown_align:
            align_mode = _get_alignment(block_bbox, prev_bbox)
        else:
            align_mode = None

        if is_cross or is_updown_align:
            current_group.append(block)
            current_indices.append(idx)
            current_aligns.append(align_mode)
        else:
            merged_groups.append((current_indices, current_aligns))
            current_group = [block]
            current_indices = [idx]
            current_aligns = []
    if current_group:
        merged_groups.append((current_indices, current_aligns))

    group_ranges = []
    for gidx, aligns in merged_groups:
        start, end = min(gidx), max(gidx)
        group_ranges.append((start, end, gidx, aligns))

    result: List[dict] = []
    used = set()
    idx = 0
    while idx < len(blocks):
        found = False
        for start, end, gidx, aligns in group_ranges:
            if idx == start and all(i not in used for i in gidx):
                found = True
                imgs = [blocks[i]["img"] for i in gidx]
                ma = aligns if aligns else []
                w, h = _calc_merged_wh(imgs)
                if h / w >= 3 if w != 0 else True:
                    for j, bi in enumerate(gidx):
                        b = blocks[bi].copy()
                        b["img"] = blocks[bi]["img"]
                        b["merge_aligns"] = None
                        result.append(b)
                        used.add(bi)
                else:
                    merged_img = _merge_images(imgs, ma, layout_shape_mode)
                    for j, bi in enumerate(gidx):
                        b = blocks[bi].copy()
                        b["img"] = merged_img if j == 0 else None
                        b["merge_aligns"] = ma if j == 0 else None
                        b["group_id"] = gidx[0]
                        result.append(b)
                        used.add(bi)
                insert_list = [ni for ni in range(start + 1, end) if ni in non_merge_blocks]
                for ni in insert_list:
                    result.append(non_merge_blocks[ni])
                    used.add(ni)
                idx = end + 1
                break
        if found:
            continue
        if idx in non_merge_blocks and idx not in used:
            result.append(non_merge_blocks[idx])
            used.add(idx)
        idx += 1
    return result


def _to_pil(img) -> Image.Image:
    if isinstance(img, np.ndarray):
        return Image.fromarray(img)
    return img


def _to_np(img) -> np.ndarray:
    if isinstance(img, Image.Image):
        return np.array(img)
    return img


def _calc_merged_wh(images) -> Tuple[int, int]:
    w = max(_to_pil(im).width for im in images)
    h = sum(_to_pil(im).height for im in images)
    return w, h


def _merge_images(images, aligns, layout_shape_mode="auto") -> np.ndarray:

    if not images:
        return None
    if len(images) == 1:
        return _to_np(images[0])
    if isinstance(aligns, str):
        aligns = [aligns] * (len(images) - 1)

    pil_images = [_to_pil(img) for img in images]
    x_offsets = [0] * len(pil_images)
    merged_w = pil_images[0].width

    for i in range(1, len(pil_images)):
        img2_w = pil_images[i].width
        step_w = max(merged_w, img2_w)
        align = aligns[i - 1]
        if align == "center":
            x1, x2 = (step_w - merged_w) // 2, (step_w - img2_w) // 2
        elif align == "right":
            x1, x2 = step_w - merged_w, step_w - img2_w
        else:
            x1, x2 = 0, 0
        for k in range(i):
            x_offsets[k] += x1
        x_offsets[i] = x2
        merged_w = step_w

    total_h = sum(img.height for img in pil_images)
    canvas = Image.new("RGB", (merged_w, total_h), (255, 255, 255))
    y_offset = 0
    for i, img in enumerate(pil_images):
        canvas.paste(img, (x_offsets[i], y_offset))
        y_offset += img.height
    return _to_np(canvas)


class PPDocLayoutV3TorchDetector(BaseLayoutDetector):
    'PP-DocLayoutV3 through pure transformers + numpy post-processing.'

    name = "ppdoclayout3_torch"

    def _start(self) -> None:
        import cv2
        import torch
        from transformers import AutoModelForObjectDetection

        self._cv2 = cv2
        self._labels = PX_LABELS

        self.device = str(self.config.get("device", "cpu") or "cpu")
        self._model_dir = str(self.config.get("model_dir", "") or "")
        if not self._model_dir:
            raise LayoutError(
                "layout.model_dir is required for provider ppdoclayout3_torch"
            )
        p = Path(self._model_dir)
        if not (p / "config.json").is_file():
            raise FileNotFoundError(
                "ppdoclayout3_torch needs a HuggingFace model dir with config.json + "
                "model.safetensors. For the Paddle inference format use "
                "ppdoclayout3_paddlex instead. Not found: %s" % self._model_dir
            )


        import json
        cfg_data = json.loads((p / "config.json").read_text(encoding="utf-8"))
        model_type = cfg_data.get("model_type", "")
        if model_type != "pp_doclayout_v3":
            raise ValueError(
                "ppdoclayout3_torch only supports model_type=pp_doclayout_v3, "
                "but config.json says %r. Got the wrong model?" % model_type
            )

        self._threshold = float(self.config.get("threshold", 0.3))
        self._layout_nms = bool(self.config.get("nms", True))

        t0 = time.time()
        self._model = AutoModelForObjectDetection.from_pretrained(
            self._model_dir,
            dtype=torch.float32,
            local_files_only=True,
        ).eval()

        if self.device.startswith("cuda"):
            self._model = self._model.to(self.device)
        elif self.device.startswith("gpu"):
            idx = self.device.split(":")[-1] if ":" in self.device else "0"
            self._model = self._model.to("cuda:" + idx)

        self.model_load_sec = time.time() - t0

    def detect(self, images: Sequence) -> List[List[Dict]]:
        'Batch-detect layout regions. Detections are coordinate-identical to the PaddleX reference pipeline for single-page input (batch_size=1). Batching multiple pages (len(images) > 1) triggers different CUDA kernel selection and may produce 1-pixel coordinate differences due to framework-level float precision; use single-page for verification.'
        if len(images) == 1:
            return [self._detect_one(images[0])]


        import torch

        tensors = []
        sizes = []
        for image in images:
            img = image.convert("RGB") if hasattr(image, "convert") else image
            img_rgb = np.asarray(img)
            h0, w0 = img_rgb.shape[:2]
            sizes.append((w0, h0))
            img_bgr = self._cv2.cvtColor(img_rgb, self._cv2.COLOR_RGB2BGR)
            img_resized = self._cv2.resize(img_bgr, (800, 800), interpolation=self._cv2.INTER_CUBIC)
            sp = list(self._cv2.split(img_resized))
            for c in range(3):
                sp[c] = sp[c].astype(np.float32) * (1.0 / 255.0)
            img_norm = self._cv2.merge(sp).transpose(2, 0, 1)
            tensors.append(torch.from_numpy(img_norm))

        batch_tensor = torch.stack(tensors).to(self._model.device, dtype=torch.float32)
        with torch.no_grad():
            out = self._model(pixel_values=batch_tensor)

        results: List[List[Dict]] = []
        for i in range(len(images)):
            w, h = sizes[i]
            logits_np = out.logits[i].cpu().squeeze(0).numpy()
            pred_boxes_np = out.pred_boxes[i].cpu().squeeze(0).numpy()

            order_np = out.order_logits[i].cpu().numpy()
            boxes_7col = _postprocess_7col(logits_np, pred_boxes_np, order_np, w, h, topk=300)
            box_dicts = _layout_analysis_postprocess(
                boxes_7col, w, h, self._labels,
                threshold=self._threshold, do_nms=self._layout_nms,
                merge_bboxes_mode=MERGE_BBOXES_MODE,
            )
            page_dets: List[Dict] = []
            for index, b in enumerate(box_dicts):
                page_dets.append({
                    "index": index,
                    "label": b["label"],
                    "class_id": b["cls_id"],
                    "score": b["score"],
                    "bbox": [float(v) for v in b["coordinate"]],
                    "polygon": [],
                })
            results.append(page_dets)
        return results

    def _detect_one(self, image) -> List[Dict]:
        import torch

        img = image.convert("RGB") if hasattr(image, "convert") else image
        img_rgb = np.asarray(img)
        h0, w0 = img_rgb.shape[:2]


        img_bgr = self._cv2.cvtColor(img_rgb, self._cv2.COLOR_RGB2BGR)
        img_resized = self._cv2.resize(img_bgr, (800, 800), interpolation=self._cv2.INTER_CUBIC)
        sp = list(self._cv2.split(img_resized))
        for c in range(3):
            sp[c] = sp[c].astype(np.float32) * (1.0 / 255.0)
        img_norm = self._cv2.merge(sp).transpose(2, 0, 1)
        tensor = torch.from_numpy(img_norm).unsqueeze(0).to(self._model.device, dtype=torch.float32)

        with torch.no_grad():
            out = self._model(pixel_values=tensor)

        logits_np = out.logits.cpu().squeeze(0).numpy()
        pred_boxes_np = out.pred_boxes.cpu().squeeze(0).numpy()
        order_np = out.order_logits.cpu().squeeze(0).numpy()

        boxes_7col = _postprocess_7col(logits_np, pred_boxes_np, order_np, w0, h0, topk=300)

        box_dicts = _layout_analysis_postprocess(
            boxes_7col, w0, h0, self._labels,
            threshold=self._threshold,
            do_nms=self._layout_nms,
            merge_bboxes_mode=MERGE_BBOXES_MODE,
        )

        result: List[Dict] = []
        for index, b in enumerate(box_dicts):
            result.append({
                "index": index,
                "label": b["label"],
                "class_id": b["cls_id"],
                "score": b["score"],
                "bbox": [float(v) for v in b["coordinate"]],
                "polygon": [],
            })
        return result

    def crop(self, image, detections: Sequence[Dict]) -> List[Dict]:
        'Full filter → crop → merge chain, matching ppdoclayout3_paddlex.'
        img_rgb = np.array(image.convert("RGB"))


        boxes = []
        for d in detections:
            box = {
                "cls_id": int(d["class_id"]),
                "label": d["label"],
                "score": float(d["score"]),
                "coordinate": [float(v) for v in d["bbox"]],
            }
            if d.get("polygon"):
                box["polygon_points"] = np.asarray(d["polygon"], dtype=np.float64).reshape(-1, 2)
            boxes.append(box)


        boxes = _filter_overlap_boxes(boxes, LAYOUT_SHAPE_MODE)
        if not boxes:
            return []


        meta_by_coord = {tuple(b["coordinate"]): (b["cls_id"], b["score"]) for b in boxes}
        cropped = _crop_by_boxes(img_rgb, boxes, LAYOUT_SHAPE_MODE)


        merged = _merge_blocks(cropped, NON_MERGE_LABELS, LAYOUT_SHAPE_MODE)


        blocks: List[Dict] = []
        for block in merged:
            label = str(block["label"])
            class_id, score = meta_by_coord.get(
                tuple(float(v) for v in block["box"]), (-1, 0.0)
            )
            blocks.append({
                "label": label,
                "class_id": int(class_id),
                "score": float(score),
                "bbox": [int(round(float(v))) for v in block["box"]],
                "image": block.get("img"),
                "polygon": polygon_to_list(block.get("polygon_points")),
                "skip_vlm": label in self.skip_vlm_labels,


                "group_id": block.get("group_id"),
            })
        return blocks

    def model_ref(self) -> str:
        return getattr(self, "_model_dir", "") or str(self.config.get("model_dir", "") or "")

    @staticmethod
    def validate_config(layout_cfg: Dict) -> None:
        model_dir = str(layout_cfg.get("model_dir", "") or "").strip()
        if not model_dir:
            raise ValueError("layout.model_dir is required for provider ppdoclayout3_torch")
        p = Path(model_dir)
        if not (p / "config.json").is_file():
            raise FileNotFoundError(
                "ppdoclayout3_torch needs a HuggingFace model dir with config.json + "
                "model.safetensors. For the Paddle inference format use "
                "ppdoclayout3_paddlex instead. Not found: %s" % model_dir
            )

        import json
        cfg_data = json.loads((p / "config.json").read_text(encoding="utf-8"))
        model_type = cfg_data.get("model_type", "")
        if model_type != "pp_doclayout_v3":
            raise ValueError(
                "ppdoclayout3_torch only supports model_type=pp_doclayout_v3, "
                "but config.json says %r. Got the wrong model?" % model_type
            )
