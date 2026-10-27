#!/usr/bin/env python3

from __future__ import annotations

import os
import time

import obs_jobs
from model_manager import Runner


def main() -> None:
    if os.environ.get("OCR_DISPATCH_RECOVER") == "1":
        obs_jobs.recover_interrupted()
    runner = Runner()
    while True:
        obs_jobs.dispatch_queued(runner)
        time.sleep(0.2)


if __name__ == "__main__":
    main()
