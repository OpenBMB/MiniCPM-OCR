# MiniCPM-OCR Jev Local Deployment

[中文版](minicpm_ocr_jev_tutorial_zh.md)

MiniCPM-OCR Jev is used to check whether an OCR parsing result matches the original image: given an image region and the corresponding parsing result, it returns a consistency score between 0 and 1. Use it to **select the best of several candidates**, **flag low-quality parsing results** for human review, or **rank outputs from multiple OCR models**.

To deploy MiniCPM-OCR Jev on a wider range of AI chips, see the [FlagOS multi-chip deployment guide](./flagos_deploy_en.md) for supported platforms, model downloads, and container image usage.

[Hardware requirements](#hardware-requirements) · [Deploy with Docker](#option-1-docker-image) · [Deploy with the SDK](#option-2-sdk-deployment)

---

## Hardware requirements

| Item | Requirement |
|---|---|
| GPU | NVIDIA, ≥12GB VRAM |
| Driver | ≥535 |
| Python | ≥3.10 (SDK deployment only) |
| Disk | about 5–9 GB for the forward environment, about 1.5 GB for the render environment, about 2.5 GB for the weights |

---

## Deployment options

A renderer is shaped by the environment it is installed in: the same text produces different renders under different versions and font dependencies, and **the consistency of the render environment affects the absolute value of the score**. That is why we offer two local deployments, a Docker image and an SDK. Their default usage is the same — you send the original image and the candidate text, and rendering happens inside the service. They differ in the render environment:

The **Docker image** ships pinned versions of Chromium, CJK fonts and the render dependencies. Its renders are identical to those of the cloud API, so the scores can be compared directly against published numbers.

The **SDK deployment** decouples the renderer from the model service, and the model service supports several inference backends, so it fits more environments. Under the SDK, the renderer you install depends on your own environment and will differ slightly from the one in the image: the ranking of scores stays stable, but absolute values may shift a little. If you already have render images, you can skip rendering altogether and talk to the model service directly, which is the lightest setup of all.


### Option 1: Docker image

Build:

```bash
cd scripts/minicpm-ocr-jev
docker build -f serve/Dockerfile -t minicpm-ocr-jev-1-0:latest .
```

On a slow network add `--build-arg PIP_INDEX_URL=https://<mirror>/simple` and `--build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://<mirror>`.

Run (mount the weights, map the port):

```bash
docker run -d --name minicpm-ocr-jev --gpus '"device=0"' \
    -p 127.0.0.1:8030:8030 \
    -v /path/to/checkpoint:/weights:ro \
    minicpm-ocr-jev-1-0:latest 8030 /weights
```

Health check:

```bash
curl -f http://127.0.0.1:8030/healthz
```

Once the service is ready you can score. A single scoring request looks like this:

```bash
curl -s http://127.0.0.1:8030/v1/rm/score -H 'Content-Type: application/json' -d '{
  "input_form": "ternary",
  "items": [
    {"case_id": "blk-001", "image": "data:image/png;base64,<base64>",
     "ocr_text": "the OCR text to be scored", "category": "text"}
  ]
}'
```

```json
{
  "results": [
    {"case_id": "blk-001", "category": "text", "verdict": "scored",
     "prob_yes": 0.99509, "prob_no": 0.00491, "detail": ""}
  ],
  "summary": {"total": 1, "scored": 1, "pass_rate": 1.0, "throughput_rate": 1.0, …}
}
```

`image` takes a `data:image/png;base64,` or `data:image/jpeg;base64,` prefix followed by the base64 body. `category` must match the real type of the block (`text` / `formula` / `table`); getting it wrong raises no error but skews the score. **Always read** `verdict` **before using a score** — `0.0` and `-1.0` are the fixed values returned when scoring failed, not low scores.

For the other endpoints (`/v1/rm/score_best`, `/v1/rm/score_best_batch`) and the full field definitions, see the [Docker image API reference](./minicpm_ocr_jev_docker_api_en.md).


### Option 2: SDK deployment

No Docker: the renderer and the model service are installed separately on the host. There are two deployment shapes, told apart by **who provides the render image**:

- **Score-only deployment**: you already have the rendered images and only want scores. Input is original image + render image + text, output is the score. The host needs no Chromium, Node, or fonts.
- **Render+score deployment**: you only have candidate text and let the service render. Input is original image + text, output is the score. It needs the full render environment, and in exchange you get exactly the same endpoints and field names as the Docker image, along with interfaces such as best-of-N within a block.

Both shapes use the same model and the same scoring code; they differ only in the source of the render image.

#### Inference scoring

Scoring can use several inference engines: [vLLM](./vllm_deploy_jev_en.md), [SGLang](./sglang_deploy_jev_en.md), [llama.cpp](./llamacpp_deploy_jev_en.md), [Ollama](./ollama_deploy_jev_en.md)

#### Requirements

The SDK needs two separately installed virtual environments:

| Environment | What it runs | Version requirements |
| ---- | ---- | ---- |
| Engine environment | the forward pass | depends on the backend; see the corresponding documents above |
| Service environment | the scoring service, plus rendering when the renderer is built in | Python ≥3.10; `Pillow==12.3.0`, `playwright==1.62.0` |

---

## How it works

Scoring one candidate text happens in three stages:

```
    precheck  ---->    render    ---->   forward
 (LaTeX validation)  (render to image)  (vLLM forward pass)
```

**precheck** first checks that the candidate text is well formed (formula blocks get their LaTeX syntax validated); a syntax error is rejected right there. **render** draws the candidate text into an image, so the model can actually "see" its layout rather than only read characters. **forward** sends the original image, the rendered image and the candidate text to the model, which returns the score.

---

## FAQ

| Problem | What to do |
|---|---|
| `category` is wrong | A formula block sent as `text` gets its LaTeX rendered literally; the score is distorted and nothing is reported. It must match the real type of the block |
| The score comes back `0.0` or `-1.0` | Those are not probabilities but the fixed values returned when scoring failed; read `verdict` on the same item for the reason |
| The service will not start, reporting a prompt mismatch | The prompt the engine assembles differs from the one used in training; check it as described under "Startup self-check" in [vllm_deploy_jev_en.md](./vllm_deploy_jev_en.md) |
| Renders drift | A self-installed renderer draws slightly different pixels than the one in the image; the ranking does not change, and the third decimal place is not promised |
