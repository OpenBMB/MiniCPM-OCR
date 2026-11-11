'Models loaded once and used by several runs.'
from __future__ import annotations

from typing import Dict

from .upright import build_upright_corrector
from ..layouts import create_layout_detector


class LoadedModels(dict):
    """The ``resources`` of a run, loaded ahead of it: pass it to as many runs as you like.

    Holds the layout detectors and the upright corrector. A run that is given
    them neither loads nor unloads its own, so only the first run pays for
    loading. One set serves one run at a time. ``close()`` unloads; so does
    leaving a ``with`` block.
    """

    def close(self) -> None:
        for detector in self.pop("detectors", []):
            detector.stop()
        self.pop("upright", None)

    def __enter__(self) -> "LoadedModels":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()


def load_models(cfg: Dict) -> LoadedModels:
    """Load what ``cfg`` needs for layout detection, once, for several runs.

    Reads ``layout``, ``upright`` and ``pipeline.layout_workers``; the runs that
    reuse the result must keep those settings, since the loaded models win.
    """
    workers = max(1, int((cfg.get("pipeline") or {}).get("layout_workers", 1) or 1))
    models = LoadedModels(detectors=[])
    try:
        for _ in range(workers):
            detector = create_layout_detector(cfg["layout"])
            detector.start()
            models["detectors"].append(detector)
        models["upright"] = build_upright_corrector(cfg)
    except BaseException:
        models.close()
        raise
    return models
