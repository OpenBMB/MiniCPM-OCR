from __future__ import annotations

import base64
import io
import logging
import threading
import time
from typing import Dict, List, Optional

import requests
from requests.adapters import HTTPAdapter

LOGGER = logging.getLogger(__name__)


_CATEGORY_BY_LABEL = {
    "text": "text",
    "title": "text",
    "plain_text": "text",
    "caption": "text",
    "footnote": "text",
    "header": "text",
    "footer": "text",
    "reference": "text",
    "formula": "formula",


    "display_formula": "formula",
    "isolate_formula": "formula",
    "inline_formula": "formula",
    "interline_equation": "formula",
    "table": "table",
}


def category_for_label(label: str) -> str:
    return _CATEGORY_BY_LABEL.get((label or "").strip().lower(), "text")


def text_for_scoring(text: str, label: str) -> str:
    '打分用文本：table 块转成 HTML，其余类目一字不改。'
    if category_for_label(label) != "table":
        return text

    from ._text import _normalize_crop_text
    scored = _normalize_crop_text(text, "table")
    return scored if scored else text


class RMClient:
    def __init__(self, tts_cfg: Dict):
        self.enabled = bool(tts_cfg.get("enabled", False))
        self.base_url = str(tts_cfg.get("rm_url", "")).rstrip("/")
        self.timeout_sec = float(tts_cfg.get("timeout_sec", 120))
        self.fallback_to_greedy = bool(tts_cfg.get("fallback_to_greedy", True))


        self.input_form = str(tts_cfg.get("rm_input_form", "")).strip()
        if self.enabled and self.input_form not in ("binary", "ternary"):
            raise ValueError(
                "tts.rm_input_form 必须显式填 binary 或 ternary（实得 %r）。"
                "不给默认值是有意的：默认成 binary 会让三元部署静默降级，"
                "默认成 ternary 会让二元部署陪着渲染还被喂错模板。" % self.input_form)
        self.http = requests.Session()
        self.http.trust_env = False


        pool = max(1, int(tts_cfg.get("http_pool_maxsize", 64)))
        adapter = HTTPAdapter(pool_connections=pool, pool_maxsize=pool, pool_block=True)
        self.http.mount("http://", adapter)
        self.http.mount("https://", adapter)


        self.table_html_count = 0
        self._count_lock = threading.Lock()

    def close(self) -> None:
        if self.table_html_count:
            LOGGER.info("RM 打分前把 %d 个 table 候选由 OTSL 转成 HTML"
                        "（落盘 candidates 仍为引擎原文）", self.table_html_count)
        self.http.close()

    def build_payload(self, image, candidates: List[str], label: str,
                      case_id: str = "") -> Dict:
        'Build the RM payload, converting table candidates to HTML for scoring.'
        scored = [text_for_scoring(text, label) for text in candidates]
        changed = sum(1 for a, b in zip(candidates, scored) if a != b)
        if changed:
            with self._count_lock:
                self.table_html_count += changed
        return {
            "input_form": self.input_form,
            "case_id": case_id,
            "image": _encode_png_b64(image),
            "candidates": scored,
            "category": category_for_label(label),
        }

    def score_best(self, image, candidates: List[str], label: str,
                   case_id: str = "", force: bool = False) -> Optional[Dict]:
        'Pick the best of ``candidates``.'
        if not self.enabled or not self.base_url or not candidates:
            return None
        if len(candidates) == 1 and not force:
            return {"best_index": 0, "best_text": candidates[0],
                    "scores": [], "verdicts": []}

        payload = self.build_payload(image, candidates, label, case_id)
        t0 = time.time()
        try:
            resp = self.http.post(
                "%s/v1/rm/score_best" % self.base_url,
                json=payload,
                timeout=self.timeout_sec,
            )
            resp.raise_for_status()
            body = resp.json()
        except Exception as err:
            if not self.fallback_to_greedy:
                raise
            return _failure(candidates, err, call_sec=time.time() - t0)
        return _adopt(candidates, body, call_sec=time.time() - t0)

    def score_best_batch(self, payloads: List[Dict]) -> Dict:
        'One HTTP call for several blocks. Returns the parsed body.'
        resp = self.http.post(
            "%s/v1/rm/score_best_batch" % self.base_url,


            json={"input_form": self.input_form, "items": payloads},
            timeout=self.timeout_sec,
        )
        resp.raise_for_status()
        return resp.json()


def _failure(candidates: List[str], reason, *, call_sec: float = 0.0) -> Dict:

    text = "%s: %s" % (type(reason).__name__, reason) if isinstance(reason, BaseException) else str(reason)
    LOGGER.warning("RM score_best failed (%s), keeping greedy candidate", text)
    return {"best_index": 0, "best_text": candidates[0], "scores": [], "verdicts": [],
            "error": text, "call_sec": call_sec}


def _adopt(candidates: List[str], body: Dict, *, call_sec: float = 0.0) -> Dict:
    index = int(body.get("best_index", 0))
    if not 0 <= index < len(candidates):
        return _failure(candidates, "out-of-range best_index=%s" % index, call_sec=call_sec)
    return {
        "best_index": index,
        "best_text": candidates[index],
        "scores": body.get("scores", []),
        "verdicts": body.get("verdicts", []),


        "stage_sec": body.get("stage_sec", {}),
        "batch_size": body.get("batch_size", 0),
        "call_sec": call_sec,
    }


class _Slot:


    __slots__ = ("payload", "candidates", "result", "done", "queued_at", "wait_sec")

    def __init__(self, payload: Dict, candidates: List[str]) -> None:
        self.payload = payload
        self.candidates = candidates
        self.result: Optional[Dict] = None
        self.done = threading.Event()
        self.queued_at = time.time()
        self.wait_sec = 0.0

    def settle(self, result: Dict) -> None:
        result["wait_sec"] = self.wait_sec
        self.result = result
        self.done.set()


class RMBatcher:
    'Blocking cross-block batcher: send when ``max_items`` pile up or a waiter has waited ``max_wait_sec``.'

    def __init__(self, client: "RMClient", max_items: int = 4, max_wait_sec: float = 0.05) -> None:
        self.client = client
        self.max_items = max(1, int(max_items))
        self.max_wait_sec = max(0.0, float(max_wait_sec))
        self._lock = threading.Lock()
        self._pending: List[_Slot] = []

    @property
    def enabled(self) -> bool:
        return self.client.enabled and bool(self.client.base_url)

    def score_best(self, image, candidates: List[str], label: str,
                   case_id: str = "", force: bool = False) -> Optional[Dict]:
        'Same contract as ``RMClient.score_best``, plus wait_sec/call_sec.'
        if not self.enabled or not candidates:
            return None
        if len(candidates) == 1 and not force:
            return {"best_index": 0, "best_text": candidates[0],
                    "scores": [], "verdicts": []}

        slot = _Slot(self.client.build_payload(image, candidates, label, case_id), candidates)
        batch = None
        with self._lock:
            self._pending.append(slot)
            if len(self._pending) >= self.max_items:
                batch, self._pending = self._pending, []

        if batch is None and not slot.done.wait(self.max_wait_sec):

            with self._lock:
                if not slot.done.is_set() and slot in self._pending:
                    batch, self._pending = self._pending, []

        if batch is not None:
            self._dispatch(batch)
        slot.done.wait()
        return slot.result

    def flush(self) -> None:
        with self._lock:
            batch, self._pending = self._pending, []
        if batch:
            self._dispatch(batch)

    def _dispatch(self, batch: List[_Slot]) -> None:
        now = time.time()
        for slot in batch:
            slot.wait_sec = now - slot.queued_at

        t0 = time.time()
        try:
            body = self.client.score_best_batch([slot.payload for slot in batch])
            results = body.get("results") or []
            if len(results) != len(batch):
                raise ValueError("batch returned %d results for %d items"
                                 % (len(results), len(batch)))
        except Exception as err:


            call_sec = time.time() - t0
            for slot in batch:
                slot.settle(_failure(slot.candidates, err, call_sec=call_sec))
            if not self.client.fallback_to_greedy:
                raise
            return

        call_sec = time.time() - t0
        batch_size = int(body.get("batch_size") or 0)
        stage_sec = body.get("stage_sec") or {}
        for slot, result in zip(batch, results):
            adopted = _adopt(slot.candidates, result, call_sec=call_sec)


            adopted["stage_sec"] = stage_sec
            adopted["batch_size"] = batch_size
            adopted["batch_items"] = len(batch)
            slot.settle(adopted)


def _encode_png_b64(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_rm_caller(tts_cfg: Dict, client: "RMClient"):
    'Pick the scoring entry point: batched when configured, else per-block.'
    batch_cfg = dict(tts_cfg.get("rm_batch") or {})
    max_items = int(batch_cfg.get("max_items", 1))
    if max_items <= 1:
        return client, None
    batcher = RMBatcher(
        client,
        max_items=max_items,
        max_wait_sec=float(batch_cfg.get("max_wait_ms", 50)) / 1000.0,
    )
    return batcher, batcher


__all__ = ["RMClient", "RMBatcher", "build_rm_caller", "category_for_label",
           "text_for_scoring"]
