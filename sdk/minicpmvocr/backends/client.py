from __future__ import annotations

import base64
import io
import random
import threading
import time
from typing import Dict, Optional

import requests

from .dialects import CropRequest, Dialect, DialectError


class EngineError(RuntimeError):
    pass


PNG_COMPRESS_LEVEL = 1


def encode_image_b64(image, image_format: str = "PNG") -> str:
    buf = io.BytesIO()
    save_kwargs = {"compress_level": PNG_COMPRESS_LEVEL} if image_format == "PNG" else {}
    image.save(buf, format=image_format, **save_kwargs)
    return base64.b64encode(buf.getvalue()).decode()


class VLMClient:
    def __init__(self, cfg: Dict, dialect: Dialect):
        self.cfg = cfg
        self.dialect = dialect
        self.name = dialect.name
        self.engine_cfg = cfg["engine"]
        self.mm_cfg = cfg.get("mm", {})
        self.decode_cfg = cfg.get("decode", {})

        server_urls = [str(u).strip() for u in (self.engine_cfg.get("server_urls") or []) if str(u).strip()]
        server_url_single = str(self.engine_cfg.get("server_url", "")).strip()
        if server_url_single:
            server_urls.insert(0, server_url_single)
        if not server_urls:
            port = self.engine_cfg.get("port")
            if not port:
                raise ValueError("engine.server_url or engine.server_urls is required; specify --server-url URL")
            server_urls = ["http://127.0.0.1:%s" % port]
        self.server_urls = [u.rstrip("/") for u in server_urls]
        self.server_url = self.server_urls[0]


        self._local = threading.local()


    def _url(self, base_url: str, configured: str, default_path: str) -> str:
        path = str(configured or "").strip() or default_path
        return "{}{}".format(base_url, path if path.startswith("/") else "/" + path)

    def chat_url(self, base_url: str) -> str:
        return self._url(base_url, self.engine_cfg.get("chat_path", ""), self.dialect.chat_path)

    def health_url(self, base_url: str) -> str:
        return self._url(base_url, self.engine_cfg.get("health_path", ""), self.dialect.health_path)

    def request_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        api_key = str(self.engine_cfg.get("api_key", "") or "").strip()
        if api_key:
            headers["Authorization"] = "Bearer %s" % api_key
        for k, v in (self.engine_cfg.get("extra_headers") or {}).items():
            headers[str(k)] = str(v)
        return headers


    def start(self) -> None:
        self.wait_ready(timeout_sec=int(self.engine_cfg.get("startup_timeout_sec", 1800)))

    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()

            session.trust_env = False
            self._local.session = session
        return session

    def stop(self) -> None:


        session = getattr(self._local, "session", None)
        if session is not None:
            session.close()
            self._local.session = None


    close = stop

    def check_ready(self, base_url: str) -> None:
        url = self.health_url(base_url)
        resp = self._session().get(url, headers=self.request_headers(), timeout=10)
        resp.raise_for_status()
        try:
            body = resp.json()
        except ValueError:
            body = None
        problem = self.dialect.check_health(self.engine_cfg, body)
        if problem:
            raise EngineError("{} not ready: {}".format(url, problem))

    def wait_ready(self, timeout_sec: int = 1800) -> None:
        deadline = time.time() + timeout_sec
        last_err = ""
        while True:
            for base_url in self.server_urls:
                try:
                    self.check_ready(base_url)
                    return
                except Exception as e:
                    last_err = "{}: {}".format(base_url, e)
            if time.time() >= deadline:
                break
            time.sleep(5)
        raise EngineError(
            "no %s endpoint became ready within %ss (%s). Start the server first, e.g. scripts/start_%s.sh; "
            "last error: %s" % (self.name, timeout_sec, ", ".join(self.server_urls), self.name, last_err)
        )


    def clamp_max_tokens(self, max_new_tokens: int) -> int:
        requested = int(max_new_tokens)
        model_max_len = int(self.engine_cfg.get("max_model_len", 0) or 0)
        if model_max_len <= 0:
            return requested
        prompt_reserve_tokens = int(self.engine_cfg.get("prompt_reserve_tokens", 512) or 512)
        return min(requested, max(256, model_max_len - max(1, prompt_reserve_tokens)))

    def _is_context_overflow(self, status_code: int, body: str) -> bool:
        if status_code not in self.dialect.context_overflow_codes:
            return False
        lowered = (body or "").lower()
        return any(marker in lowered for marker in self.dialect.context_overflow_markers)

    def recognize(self, image, prompt: str, max_new_tokens: int, slice_nums: Optional[int] = None,
                  n: int = 1, decode_overrides: Optional[Dict] = None) -> Dict:


        encode_t0 = time.time()
        image_b64 = encode_image_b64(image)
        encode_sec = time.time() - encode_t0
        max_tokens = self.clamp_max_tokens(max_new_tokens)

        ready_timeout_sec = float(self.engine_cfg.get("request_ready_timeout_sec", 600))
        retry_interval_sec = float(self.engine_cfg.get("request_retry_interval_sec", 2))
        request_timeout_sec = float(self.engine_cfg.get("request_timeout_sec", 300))
        deadline = time.time() + ready_timeout_sec
        headers = self.request_headers()
        last_err = ""
        queue_wait_sec = 0.0

        request_http = self._session()
        while True:
            request_urls = list(self.server_urls)
            random.shuffle(request_urls)

            last_endpoint_err = ""
            lowered_tokens = False
            for target_url in request_urls:
                req = CropRequest(
                    image_b64=image_b64,
                    prompt=prompt,
                    max_tokens=max_tokens,
                    slice_nums=slice_nums,
                    n=n,
                    decode_overrides=decode_overrides,
                )
                build_t0 = time.time()
                payload = self.dialect.build_payload(req, self.engine_cfg, self.mm_cfg, self.decode_cfg)
                build_sec = time.time() - build_t0
                try:
                    started = time.time()
                    resp = request_http.post(
                        self.chat_url(target_url),
                        json=payload,
                        headers=headers,
                        timeout=request_timeout_sec,
                    )
                    latency = time.time() - started

                    if resp.status_code >= 400:
                        body = resp.text or ""
                        if self._is_context_overflow(resp.status_code, body) and max_tokens > 256:
                            max_tokens = max(256, max_tokens // 2)
                            last_endpoint_err = "{} context overflow, retry with max_tokens={}: {}".format(
                                target_url, max_tokens, body[:300]
                            )
                            lowered_tokens = True
                            break
                        resp.raise_for_status()

                    parse_t0 = time.time()
                    result = self.dialect.parse_response(resp.json())
                    parse_sec = time.time() - parse_t0
                    metrics = result.setdefault("request_metrics", {})
                    metrics["latency_sec"] = latency
                    metrics["endpoint"] = target_url
                    metrics["backend"] = self.name
                    metrics["client_encode_sec"] = round(encode_sec, 6)
                    metrics["client_payload_build_sec"] = round(build_sec, 6)
                    metrics["client_post_sec"] = round(latency, 6)
                    metrics["client_parse_sec"] = round(parse_sec, 6)
                    metrics["client_queue_wait_sec"] = round(queue_wait_sec, 6)
                    metrics["client_overhead_sec"] = round(encode_sec + build_sec + parse_sec, 6)
                    metrics["image_b64_bytes"] = len(image_b64)
                    return result
                except Exception as endpoint_err:
                    last_endpoint_err = "{}: {}".format(target_url, endpoint_err)
                    continue

            last_err = last_endpoint_err or "all endpoints failed"
            if lowered_tokens:
                continue
            if time.time() >= deadline:
                raise EngineError(
                    "%s request failed until timeout (%ss): %s" % (self.name, ready_timeout_sec, last_err)
                )
            time.sleep(retry_interval_sec)
            queue_wait_sec += retry_interval_sec


    predict_crop = recognize


__all__ = ["EngineError", "DialectError", "VLMClient", "encode_image_b64"]
