#!/usr/bin/env bash
# Check that the environment variables needed by the backend are set, then
# import the packages the upright and layout steps use.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../env.sh"
ocr_require OCR_UPRIGHT_DIR
ocr_require OCR_LAYOUT_MODEL_DIR
ocr_require OCRWEB_PYTHON

"$OCRWEB_PYTHON" -s - <<PYEOF
import os, sys
ok = True

def chk(name, fn):
    global ok
    try:
        print(f"  {name}: {fn()}")
    except Exception as e:
        ok = False
        print(f"  {name}: FAILED {type(e).__name__}: {e}")

def paddle_gpu():
    import paddle
    x = paddle.to_tensor([1.0], place=paddle.CUDAPlace(0))
    return f"ok (paddle {paddle.__version__}, cuda {paddle.version.cuda()})"

def pdf():
    import fitz
    return "ok (PyMuPDF)"

def upright_models():
    from paddleocr import DocImgOrientationClassification, TextDetection, TextLineOrientationClassification
    root = os.environ["OCR_UPRIGHT_DIR"]
    DocImgOrientationClassification(model_name="PP-LCNet_x1_0_doc_ori", model_dir=root+"/PP-LCNet_x1_0_doc_ori")
    TextDetection(model_name="PP-OCRv5_mobile_det", model_dir=root+"/PP-OCRv5_mobile_det", enable_mkldnn=False)
    TextLineOrientationClassification(model_name="PP-LCNet_x1_0_textline_ori", model_dir=root+"/PP-LCNet_x1_0_textline_ori")
    return "ok (3 models)"

def layout():
    d = os.environ["OCR_LAYOUT_MODEL_DIR"]
    missing = [f for f in ("inference.pdiparams", "inference.yml") if not os.path.isfile(os.path.join(d, f))]
    if missing:
        raise FileNotFoundError(f"{d} missing {missing}")
    return f"ok ({d})"

def sdk():
    from minicpmvocr.pipeline import pipelined_run
    return "ok"

chk("paddle GPU", paddle_gpu)
chk("fitz (PDF)", pdf)
chk("upright weights", upright_models)
chk("PP-DocLayoutV3", layout)
chk("minicpmvocr SDK", sdk)
sys.exit(0 if ok else 1)
PYEOF
