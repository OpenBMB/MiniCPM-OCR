ARG BASE_IMAGE
FROM ${BASE_IMAGE}

COPY models/ocr /opt/models/ocr
COPY models/layout /opt/models/layout
COPY models/rm /opt/models/rm
COPY models/paddle_upright /opt/models/paddle_upright
RUN test -f /opt/models/ocr/config.json && test -f /opt/models/layout/inference.pdiparams \
 && test -f /opt/models/rm/model.safetensors && test -d /opt/models/paddle_upright/PP-LCNet_x1_0_doc_ori

COPY rm/node /usr/local/bin/node
COPY rm/ocr_rm_serving /opt/ocr-rm-serving/ocr_rm_serving
COPY rm/vendor /opt/ocr-rm-serving/vendor

COPY app /opt/app
RUN uv pip install --python /opt/venv/bin/python --no-build-isolation --no-deps -e /opt/app \
 && /opt/venv/bin/python -c "import minicpmvocr, sys; assert minicpmvocr.__file__.startswith('/opt/app/'), minicpmvocr.__file__"

COPY entrypoint.sh /entrypoint.sh
RUN printf '#!/usr/bin/env bash\nexec /entrypoint.sh "$@"\n' > /usr/local/bin/vllm \
 && chmod +x /entrypoint.sh /usr/local/bin/node /usr/local/bin/vllm

ENV OCR_MODEL_PATH=/opt/models/ocr \
    RM_MODEL_PATH=/opt/models/rm \
    OCR_RM_MODEL_DIR=/opt/models/rm \
    OCR_SERVED_NAME=minicpm-ocr \
    OCR_SERVED_MODEL_NAME=minicpm-ocr \
    VLLM_URL=http://127.0.0.1:18499 \
    OCR_VLLM_URL=http://127.0.0.1:18499 \
    OCR_LAYOUT_MODEL_DIR=/opt/models/layout \
    OCR_LAYOUT_DEVICE=cuda:0 \
    OCR_UPRIGHT_DIR=/opt/models/paddle_upright \
    OCR_RM_URL=http://127.0.0.1:8012 \
    OCR_RM_INPUT_FORM=binary \
    OCRWEB_DATA_DIR=/tmp/webdemo-data \
    VLLM_GDN_PREFILL_BACKEND=triton \
    VLLM_USE_FLASHINFER_SAMPLER=0 \
    VLLM_PLUGINS=lora_filesystem_resolver,lora_hf_hub_resolver \
    PYTHONNOUSERSITE=1 \
    PORT=8000

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=1200s --retries=3 \
  CMD curl -fs http://127.0.0.1:${PORT}/ready >/dev/null || exit 1
ENTRYPOINT ["/entrypoint.sh"]
CMD []
