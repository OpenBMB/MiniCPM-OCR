from __future__ import annotations

import importlib
from typing import Dict, List, Type

from .base import (
    BaseLayoutDetector,
    LayoutError,
    DEFAULT_SKIP_VLM_LABELS,
    IMAGE_LABELS,
    resolve_skip_vlm_labels,
)

_DETECTORS = {
    "ppdoclayout3_paddlex": ("ppdoclayout3_paddlex", "PPDocLayoutV3PaddleXDetector"),
    "ppdoclayout3_server": ("ppdoclayout3_server", "PPDocLayoutV3ServerDetector"),
    "ppdoclayout3_torch": ("ppdoclayout3_torch", "PPDocLayoutV3TorchDetector"),
}


def _load_detector(provider: str) -> Type[BaseLayoutDetector]:
    module_name, class_name = _DETECTORS[provider]
    module = importlib.import_module(f".{module_name}", __package__)
    return getattr(module, class_name)


class _DetectorRegistry(dict):
    def __getitem__(self, provider: str) -> Type[BaseLayoutDetector]:
        detector = super().__getitem__(provider)
        if detector is None:
            detector = _load_detector(provider)
            super().__setitem__(provider, detector)
        return detector

    def get(self, provider: str, default=None):
        return self[provider] if provider in self else default


LAYOUT_REGISTRY: Dict[str, Type[BaseLayoutDetector]] = _DetectorRegistry(
    {provider: None for provider in _DETECTORS}
)

LAYOUT_ALIASES: Dict[str, str] = {
    "paddlex": "ppdoclayout3_paddlex",
    "paddle": "ppdoclayout3_paddlex",
    "ppdoclayout3": "ppdoclayout3_paddlex",
    "ppdoclayoutv3": "ppdoclayout3_paddlex",
    "pp-doclayoutv3": "ppdoclayout3_paddlex",
    "ppdoclayoutv3_paddlex": "ppdoclayout3_paddlex",
    "ppdoclayout3_server": "ppdoclayout3_server",
    "server": "ppdoclayout3_server",
    "layout_server": "ppdoclayout3_server",
    "ppdoclayout3-torch": "ppdoclayout3_torch",
    "ppdoclayout3_torch": "ppdoclayout3_torch",
    "ppdoclayout3-t": "ppdoclayout3_torch",
    "torch": "ppdoclayout3_torch",
    "torch_layout": "ppdoclayout3_torch",
}


def list_layout_providers() -> List[str]:
    return sorted(LAYOUT_REGISTRY)


def normalize_layout_provider(provider: str) -> str:
    key = str(provider or "").strip().lower()
    key = LAYOUT_ALIASES.get(key, key)
    if key not in LAYOUT_REGISTRY:
        raise ValueError(
            "Unsupported layout.provider: {!r}. Available providers: {} (aliases: {})".format(
                provider, ", ".join(list_layout_providers()), ", ".join(sorted(LAYOUT_ALIASES))
            )
        )
    return key


def resolve_layout_provider_class(layout_cfg: Dict) -> Type[BaseLayoutDetector]:
    return LAYOUT_REGISTRY[normalize_layout_provider(layout_cfg.get("provider", ""))]


def create_layout_detector(layout_cfg: Dict) -> BaseLayoutDetector:
    return resolve_layout_provider_class(layout_cfg)(layout_cfg)


def __getattr__(name: str):
    for module_name, class_name in _DETECTORS.values():
        if name == class_name:
            module = importlib.import_module(f".{module_name}", __package__)
            return getattr(module, class_name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "DEFAULT_SKIP_VLM_LABELS",
    "IMAGE_LABELS",
    "resolve_skip_vlm_labels",
    "LAYOUT_ALIASES",
    "LAYOUT_REGISTRY",
    "BaseLayoutDetector",
    "LayoutError",
    "PPDocLayoutV3PaddleXDetector",
    "PPDocLayoutV3ServerDetector",
    "PPDocLayoutV3TorchDetector",
    "create_layout_detector",
    "list_layout_providers",
    "normalize_layout_provider",
    "resolve_layout_provider_class",
]
