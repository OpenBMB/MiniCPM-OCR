# One container, one port, two processes: `vllm serve` for the forward pass and
# app.py for precheck, rendering and the HTTP contract.
#
# It builds from a bare `ubuntu:24.04` and installs everything through the
# material's own scripts -- the same commands the deployment tutorial gives a
# reader with a fresh machine. That is deliberate: if this image builds, the
# documented install works, and there is no second, image-only path to drift
# out of step with the instructions.
#
# No weights. The checkpoint is a run-time argument, so one image serves any
# compatible checkpoint and the image itself stays something you can rebuild
# without 4 GB of context. Mount the weights and name them:
#
#   docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .
#
#   docker run -d --name minicpm-ocr-jev --gpus '"device=0"' \
#       -p 127.0.0.1:8030:8030 \
#       -v /path/to/checkpoint:/weights:ro \
#       minicpm-ocr-jev-1-0:latest 8030 /weights
#
# Behind a slow link to pypi.org or to Playwright's CDN, pass mirrors -- without
# them this build takes hours rather than minutes, almost all of it in two
# downloads:
#
#   docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest \
#       --build-arg PIP_INDEX_URL=https://<mirror>/simple \
#       --build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror> .
#
# A note on size: this image carries CUDA wheels, Chromium and CJK fonts, so it is
# not small. What it does not carry is a second copy of either -- the forward pass
# and the renderer share one base, and the weights stay outside.
FROM ubuntu:24.04

ARG PIP_INDEX_URL=""
ARG PLAYWRIGHT_DOWNLOAD_HOST=""

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# System packages, matching the documented install.
#
# gcc and python3-dev are not build-time conveniences to be removed afterwards:
# Triton compiles a CPython extension on the first forward pass of every fresh
# container, so they are needed on every cold start. Dropping them produces a
# container that loads the weights, runs for two minutes and dies on a bare
# CalledProcessError.
#
# fonts-noto-cjk is just as load-bearing for a different reason: without a CJK
# font the browser draws replacement boxes, the render is meaningless, and the
# model scores it as a mismatch with nothing to indicate fonts were the cause.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
        python3 python3-pip python3-venv python3-dev \
        gcc g++ nodejs fonts-noto-cjk fontconfig ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency manifests before the source, so editing app.py does not re-download
# Chromium or five gigabytes of CUDA wheels.
COPY requirements.txt /app/requirements.txt
COPY serve/requirements-serve.txt /app/serve/requirements-serve.txt
COPY renderer/setup_renderer.sh /app/renderer/setup_renderer.sh
COPY serve/setup_backend.sh /app/serve/setup_backend.sh

# The renderer half, in its own environment. setup_renderer.sh also checks Node
# and the fonts, so a missing one fails the build instead of the first request --
# but it needs the rest of renderer/ to check, which arrives with COPY . below;
# hence the pinned packages here and the full check further down.
RUN python3 -m venv /opt/venv-render \
 && /opt/venv-render/bin/pip install --no-cache-dir -q -U pip \
 && /opt/venv-render/bin/pip install --no-cache-dir -r /app/requirements.txt \
 && /opt/venv-render/bin/pip install --no-cache-dir -r /app/serve/requirements-serve.txt \
 && PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST}" \
    /opt/venv-render/bin/python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# Pin the font environment, matching the documented install.
#
# This has to come after the playwright install above, not before: --with-deps
# pulls in its own set of fonts, and would put the purged packages back.
#
# Rendered text is model input here, so a different face is a different score.
# The CSS stack names three faces -- Noto Sans CJK Regular and Bold, and
# DroidSansFallbackFull -- and fontconfig fills everything else by substitution,
# where the three purged packages outrank the named ones for characters Noto does
# not cover. 10-sub-pixel-rgb.conf tints glyph edges per channel: same shapes,
# different pixels. Fixing both is what makes this image render byte-identical to
# the reference deployment; without it 16.5% of blocks rank a different candidate
# first, against a 1% floor from re-running one container.
RUN apt-get update -qq \
 && apt-get install -y -qq fonts-droid-fallback \
 && apt-get purge -y -qq fonts-wqy-zenhei fonts-unifont fonts-ipafont-gothic \
 && rm -f /etc/fonts/conf.d/10-sub-pixel-rgb.conf \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*

# The forward-pass half, in a second environment -- see setup_backend.sh for why
# the two are not one. The script also asserts that this vLLM registers the
# model's architecture, which is the real requirement; the version is not.
RUN bash /app/serve/setup_backend.sh /opt/venv-vllm

COPY . /app

# Fail the build rather than the first request if an asset went missing: this
# covers KaTeX, the render module, the precheck script and Node.
RUN /opt/venv-render/bin/python -c \
    "import sys; sys.path.insert(0, '/app'); import rm_render; \
     rm_render.check_assets(require_node=True); print('renderer assets OK')"

# RM_WORKERS is deliberately unset: start_app.sh sizes it from the core count and
# caps it where one GPU backend saturates. Set it explicitly when running under a
# CPU quota -- nproc inside a container reports the host's cores, not this
# container's share, so the default over-provisions on a quota-limited host.
ENV RM_RENDER_MODE=persistent \
    RM_RENDER_BROWSERS=2 \
    RM_BROWSER_CONCURRENCY=8 \
    RM_VLLM_PORT=8026

EXPOSE 8030

# /healthz reports the backend's reachability, so this covers both halves.
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=3 \
    CMD curl -sf http://127.0.0.1:8030/healthz > /dev/null || exit 1

# Port and checkpoint are arguments, not environment: `docker run ... 8030 /weights`
# overrides them without --entrypoint, and a missing checkpoint stops the container
# instead of quietly serving nothing.
ENTRYPOINT ["bash", "/app/serve/start_all.sh"]
CMD ["8030", "/weights"]
