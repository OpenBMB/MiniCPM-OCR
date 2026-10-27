from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Sequence

import numpy as np

from .base import BaseLayoutDetector, LayoutError, polygon_to_list


from ..constants import (  # noqa: E402
    CONFIG_FILENAME,
    LAYOUT_SHAPE_MODE,
    MERGE_BBOXES_MODE,
    MODEL_NAME,
    NON_MERGE_LABELS,
    PARAMS_FILENAME,
)


def read_model_name(model_dir: str) -> str:
    '`Global.model_name` from the Paddle inference dir\'s inference.yml ("" if absent).'
    path = Path(model_dir) / CONFIG_FILENAME
    if not path.is_file():
        return ""
    try:
        import yaml

        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return str((data.get("Global") or {}).get("model_name") or "").strip()
    except Exception:
        return ""


def check_model_is_v3(model_dir: str, configured_name: str = "") -> None:
    'Refuse anything but PP-DocLayoutV3.'
    for source, name in (("layout.model_name", configured_name), (CONFIG_FILENAME, read_model_name(model_dir))):
        name = str(name or "").strip()
        if name and name != MODEL_NAME:
            raise ValueError(
                "layout provider ppdoclayout3_paddlex only supports %s, but %s says %r (model_dir=%s)"
                % (MODEL_NAME, source, name, model_dir)
            )


def to_paddle_device(device: str) -> str:
    "Translate the SDK's torch-style `layout.device` into PaddleX notation."
    device = str(device or "").strip().lower()
    if not device or device.startswith("cpu"):
        return "cpu"
    if device.startswith(("cuda", "gpu")):
        _, _, index = device.partition(":")
        return "gpu:%s" % (index if index.isdigit() else "0")
    return device


class PPDocLayoutV3PaddleXDetector(BaseLayoutDetector):
    "PP-DocLayoutV3 through PaddleX, plus PaddleOCR-VL's box filtering, polygon-masked cropping and cross-column text merging."

    name = "ppdoclayout3_paddlex"

    def _start(self) -> None:
        try:
            from paddlex import create_model
            from paddlex.inference.pipelines.components.common.crop_image_regions import CropByBoxes
            from paddlex.inference.pipelines.paddleocr_vl.uilts import filter_overlap_boxes, merge_blocks
        except Exception as e:
            raise LayoutError(
                "provider ppdoclayout3_paddlex needs paddlepaddle + paddlex "
                "(pip install '.[layout]', paddlepaddle-gpu from Paddle's own index). Original error: %s" % e
            ) from e

        self.device = to_paddle_device(self.config.get("device", "cpu"))
        self._model_dir = str(self.config.get("model_dir", "") or "")
        check_model_is_v3(self._model_dir, self.config.get("model_name", ""))
        self._model = create_model(
            model_name=MODEL_NAME,
            model_dir=self._model_dir,
            device=self.device,
            threshold=float(self.config.get("threshold", 0.3)),
            layout_nms=bool(self.config.get("nms", True)),
            layout_merge_bboxes_mode=dict(MERGE_BBOXES_MODE),
        )
        self._crop_by_boxes = CropByBoxes()
        self._filter_overlap_boxes = filter_overlap_boxes
        self._merge_blocks = merge_blocks

    def detect(self, images: Sequence) -> List[List[Dict]]:
        return [self._detect_one(image) for image in images]

    def _detect_one(self, image) -> List[Dict]:


        results = list(
            self._model.predict(
                np.asarray(image.convert("RGB")),
                batch_size=1,
                layout_shape_mode=LAYOUT_SHAPE_MODE,
                filter_overlap_boxes=False,
            )
        )
        boxes = list(results[0].get("boxes", [])) if results else []
        return [
            {
                "index": index,
                "label": str(box["label"]),
                "class_id": int(box["cls_id"]),
                "score": float(box["score"]),
                "bbox": [float(v) for v in box["coordinate"]],
                "polygon": polygon_to_list(box.get("polygon_points")),
            }
            for index, box in enumerate(boxes)
        ]

    def crop(self, image, detections: Sequence[Dict]) -> List[Dict]:
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
        boxes = self._filter_overlap_boxes({"boxes": boxes}, LAYOUT_SHAPE_MODE)["boxes"] if boxes else []


        meta_by_box = {tuple(b["coordinate"]): (b["cls_id"], b["score"]) for b in boxes}
        cropped = self._crop_by_boxes(np.asarray(image.convert("RGB")), boxes, LAYOUT_SHAPE_MODE) if boxes else []
        merged = self._merge_blocks(cropped, non_merge_labels=NON_MERGE_LABELS, layout_shape_mode=LAYOUT_SHAPE_MODE)

        blocks: List[Dict] = []
        for block in merged:
            label = str(block["label"])
            class_id, score = meta_by_box.get(tuple(float(v) for v in block["box"]), (-1, 0.0))
            blocks.append(
                {
                    "label": label,
                    "class_id": class_id,
                    "score": score,
                    "bbox": [int(round(float(v))) for v in block["box"]],
                    "image": block.get("img"),
                    "polygon": polygon_to_list(block.get("polygon_points")),
                    "skip_vlm": label in self.skip_vlm_labels,


                    "group_id": block.get("group_id"),
                }
            )
        return blocks

    def model_ref(self) -> str:
        return getattr(self, "_model_dir", "") or str(self.config.get("model_dir", "") or "")

    @staticmethod
    def validate_config(layout_cfg: Dict) -> None:
        model_dir = str(layout_cfg.get("model_dir", "") or "").strip()
        if not model_dir:
            raise ValueError("layout.model_dir is required for provider ppdoclayout3_paddlex (Paddle inference dir)")
        if not (Path(model_dir) / PARAMS_FILENAME).is_file():
            raise FileNotFoundError(
                "layout.model_dir is not a Paddle inference dir (missing %s): %s" % (PARAMS_FILENAME, model_dir)
            )
        check_model_is_v3(model_dir, layout_cfg.get("model_name", ""))
