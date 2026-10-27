#!/usr/bin/env python3

from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
from typing import Dict, List, Optional

from PIL import Image


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


VLLM_URL = (os.environ.get("OCR_VLLM_URL") or os.environ.get("VLLM_URL")
            or "http://127.0.0.1:18499").rstrip("/")
SERVED_MODEL = (os.environ.get("OCR_SERVED_MODEL_NAME") or os.environ.get("OCR_SERVED_NAME")
                or "minicpm-ocr")


def _encode_image(image: Image.Image) -> str:

    buf = io.BytesIO()
    image.save(buf, format="PNG", compress_level=1)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _post(url: str, payload: Dict, timeout: int = 240) -> Dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with _OPENER.open(req, timeout=timeout) as resp:
        return json.loads(resp.read())


class OcrService:
    'OpenAI Chat Completions 客户端，对接 vLLM 或 LIS。'

    def __init__(self, vllm_url: str = VLLM_URL,
                 model_name: str = SERVED_MODEL) -> None:
        self._url = vllm_url.rstrip("/")
        self._model = model_name
        self._mm_kwargs = {
            "downsample_mode": "4x",
            "max_slice_nums": 9,
        }
        self._decode_defaults = {
            "temperature": 0.01,
            "top_p": 0.001,
            "top_k": 1,
            "repetition_penalty": 1.0,
            "no_repeat_ngram_size": 100,
        }


    def recognize(
        self,
        image: Image.Image,
        prompt: str,
        max_new_tokens: int = 4096,
        slice_nums: Optional[int] = None,
        n: int = 1,
        decode_overrides: Optional[Dict] = None,
    ) -> Dict:
        '识别一张块图。'
        payload = self._build_payload(
            image=image,
            prompt=prompt,
            max_new_tokens=max_new_tokens,
            slice_nums=slice_nums,
            n=n,
            decode_overrides=decode_overrides,
        )
        raw = _post(self._url + "/v1/chat/completions", payload)
        return self._parse_response(raw, n)

    def health(self) -> Dict:
        '探活：检查 vLLM 是否可达，以及模型名是否匹配。'
        try:
            req = urllib.request.Request(self._url + "/v1/models")
            with _OPENER.open(req, timeout=5) as resp:
                body = json.loads(resp.read())
            served: List[str] = [m.get("id", "") for m in body.get("data", [])]
            match = self._model in served
            return {"reachable": True, "model_match": match, "served": served, "error": None}
        except Exception as exc:
            return {"reachable": False, "model_match": False, "served": [],
                    "error": f"{type(exc).__name__}: {exc}"}


    def _build_payload(
        self,
        image: Image.Image,
        prompt: str,
        max_new_tokens: int,
        slice_nums: Optional[int],
        n: int,
        decode_overrides: Optional[Dict],
    ) -> Dict:
        decode = dict(self._decode_defaults)
        if decode_overrides:
            decode.update(decode_overrides)

        payload: Dict = {
            "model": self._model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url",
                         "image_url": {"url": _encode_image(image)}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
            "max_tokens": max_new_tokens,
            "mm_processor_kwargs": dict(self._mm_kwargs),
            "chat_template_kwargs": {"enable_thinking": False},
            "temperature": decode.get("temperature", 0.01),
            "top_p": decode.get("top_p", 0.001),
            "top_k": decode.get("top_k", 1),
            "repetition_penalty": decode.get("repetition_penalty", 1.0),
            "no_repeat_ngram_size": decode.get("no_repeat_ngram_size", 100),
            "stream": False,
        }
        if slice_nums is not None:
            payload["mm_processor_kwargs"]["max_slice_nums"] = int(slice_nums)

        if n > 1:
            payload["n"] = int(n)

        handled = {"temperature", "top_p", "top_k", "repetition_penalty",
                   "no_repeat_ngram_size"}
        if decode_overrides:
            for key, value in decode_overrides.items():
                if key not in handled and key not in payload:
                    payload[key] = value
        return payload

    def _parse_response(self, raw: Dict, n: int) -> Dict:
        choices = raw.get("choices") or []
        if not choices:
            raise ValueError("vLLM returned no choices: %s" % str(raw)[:300])
        usage = raw.get("usage") or {}
        token_count = int(usage.get("completion_tokens", 0))
        if n > 1:
            texts = [(c.get("message") or {}).get("content") or "" for c in choices]
            return {"texts": texts, "output_token_count": token_count}
        choice = choices[0]
        text = (choice.get("message") or {}).get("content") or ""
        finish = choice.get("finish_reason", "")
        return {"text": text, "output_token_count": token_count,
                "finish_reason": finish, "texts": [text]}
