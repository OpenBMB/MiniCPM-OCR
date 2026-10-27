# FAQ

Common issues with installation, model download, GPU memory, input formats and unexpected output.

## Installation Issues

### `pip install minicpmvocr` package not found
**Cause**: The PyPI distribution is named `minicpm-ocr`; the Python import and command are named `minicpmvocr`.

**Solution**: Run `python -m pip install "minicpm-ocr[all]==1.0.0"`. For development from this repository, use `python -m pip install -e "./sdk[all]"`.

### `minicpmvocr parse` reports `--config` missing
**Cause**: An older SDK version is installed. The current `parse` command supports a built-in quickstart configuration.

**Solution**: Install the current SDK as described in the [tutorial](./minicpmvocr_tutorial_en.md#1-set-up-the-sdk-environment), then run this command from the repository root with the recognition service running:

```bash
minicpmvocr parse doc.pdf -o doc.md --device cuda:0 \
  --server-url http://127.0.0.1:18499 --model minicpm-ocr
```

Pass `--server-url` and `--model` explicitly each time. For custom configuration, see [SDK API and Configuration](./minicpmvocr_api_en.md).

### `Could not find nvcc` (Blackwell/5090 first startup)
**Cause**: FlashInfer JIT requires nvcc; pip's CUDA packages include the toolchain.<br>
**Solution**: Set `CUDA_HOME=$VIRTUAL_ENV/lib/pythonX.Y/site-packages/nvidia/cu13` and add `$CUDA_HOME/bin` to `PATH`

### `CUDA driver version is insufficient`
**Cause**: The current inference environment uses CUDA 13, which normally requires driver ≥580.
**Solution**: Use a compatible driver. Data-center GPUs that support CUDA forward compatibility, such as A100, can also use `cuda-compat-13-0` as described in the [NVIDIA compatibility guide](https://docs.nvidia.com/deploy/cuda-compatibility/forward-compatibility.html).

On Ubuntu with the NVIDIA CUDA package repository configured, install the compatibility library and set these variables in each terminal used to install or start vLLM:

```bash
apt-get install -y cuda-compat-13-0
export OCR_CUDA_COMPAT_DIR=/usr/local/cuda-13.0/compat
export LD_LIBRARY_PATH="$OCR_CUDA_COMPAT_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export OCR_LIBCUDA="$OCR_CUDA_COMPAT_DIR/libcuda.so.1"
```

If the compatibility library is already installed, set `OCR_CUDA_COMPAT_DIR` to its actual directory. These variables apply only to the current terminal and its child processes; set them again in each new terminal used to start the service. Activating `.venv-vllm` does not restore them. If vLLM is already installed and startup reports `The NVIDIA driver on your system is too old (found version 12040)`, set the variables and restart the service. Recompilation is not required. Once PyTorch is installed, check GPU computation with:

```bash
.venv-vllm/bin/python -c 'import torch; x = torch.ones(1, device="cuda"); print(torch.cuda.get_device_name(0), (x + 1).item())'
```

### `bin/crt/link.stub: No such file or directory`
**Cause**: The pip-installed NVCC package is missing the `bin/crt` files required for linking.
**Solution**: Rerun the current installation script. It restores these files from the matching NVIDIA NVCC distribution and verifies the SHA-256 checksum. The download URL and checksum are maintained in `pyproject.toml`.

### `flashinfer-cubin version does not match`
**Solution**: `pip uninstall flashinfer-cubin`; run `vllm download-kernels` if the command exists

### `ptxas fatal: Unsupported .version 9.4`
**Cause**: nvcc 13.0 cannot compile flashinfer 0.7's `compute_120f`.<br>
**Solution**: Unify to 13.4 series nvcc/runtime/nvrtc/nvjitlink

### `CUDA compiler and CUDA toolkit headers are incompatible`
**Cause**: First FlashInfer JIT's nvcc 13.4.92 mixed with runtime 13.0.x.<br>
**Solution**: Align CUDA components to unified runtime/nvrtc 13.4.92 per Step 2

### `ld: cannot find -lcudart`
**Solution**: Add symlinks: `lib64 -> lib`, `lib/libcudart.so -> libcudart.so.13`, `lib64/stubs/libcuda.so` (see Step 2A)

### `cuda_fp16.h ... nv/target: No such file`
**Cause**: Missing CCCL headers.<br>
**Solution**: Install `nvidia-cuda-cccl==13.3.4.3.1` when compiling feat-ocr from source

### `CUDA_nvrtc_LIBRARY ... NOTFOUND`
**Solution**: Add symlink: `ln -sf libnvrtc.so.13 $CU/lib/libnvrtc.so`

### `Failed to clone https://github.com/nvidia/cutlass.git`
**Cause**: Internal network / no GitHub access.<br>
**Solution**: Use `VLLM_CUTLASS_SRC_DIR` and other `*_SRC_DIR` env vars to point to existing `.deps` source code

### `No module named vllm._C`
**Cause**: Not a compilation failure. This branch's extension is named `_C_stable_libtorch.abi3.so`.<br>
**Solution**: Smoke test with `from vllm import LLM; LLM(...)`

### `deep_gemm ... undefined symbol: _ZSt8to_charsPcS_DF128_`
**Impact**: Non-fatal, vLLM will skip it; OCR models don't use DeepGEMM. Full fix requires recompiling that extension or unifying libstdc++ 13

## Service Issues

### Startup reports `unexpected keyword argument 'adaptive_tile_upsize'`
**Cause**: The pinned vLLM version passes `adaptive_tile_upsize` during video warmup, but the OCR image processor in the accompanying Transformers version does not accept that argument.
**Solution**: This document-parsing workflow only needs image inputs. Explicitly disable video in the vLLM launch options: `--limit-mm-per-prompt '{"image":36,"video":0}'`. Keep the CUDA compatibility-library settings in the current terminal and restart the service; recompilation is not required. The SDK still renders PDFs into page images for recognition.

### Parsing hangs until timeout with no results
**Cause**: Missing `--trust-request-mm-kwargs` at startup. Current vLLM build rejects `mm_processor_kwargs` by default (returns 400, SDK silently retries).<br>
**Solution**: Add `--trust-request-mm-kwargs` to vLLM startup command

### Service runs but output is blank/garbled
**Cause**: Missing `chat_template_kwargs: {enable_thinking: false}`.<br>
**Solution**: SDK's vllm backend has this built-in; transformers/openai backends need it in `extra_body`

### Image requests return 400
**Cause**: The number of images in the request exceeds the `--limit-mm-per-prompt` setting, or the image data URI is incorrectly formatted.
**Solution**: Add this parameter to the vLLM launch command

### vLLM startup reports `Free memory on device ... less than desired GPU memory utilization`
**Cause**: This GPU is occupied by other processes.<br>
**Solution**: Use `CUDA_VISIBLE_DEVICES` to select an idle GPU

## Runtime Issues

### `show-config` reports `At least one of input... is required`
**Cause**: `show-config` also validates input.<br>
**Solution**: Add `--set input.file_path=<existing_file>`

### feat-ocr first `verify_vllm.py` killed by SIGTERM / graph capture timeout
**Cause**: First-time CUDA graph capture can be slow.<br>
**Solution**: Re-run once after cache is warm; if still failing, add `--enforce-eager`

### Small crop image `assign N multimodal tokens to M placeholders`
**Cause**: Placeholder bug in vLLM ≤0.22.<br>
**Solution**: Upgrade to current feat-ocr vLLM build

### Table output shows `<otsl>`
**Cause**: Direct API output is in OTSL format.<br>
**Solution**: Use SDK pipeline (Step 5) for automatic HTML conversion; direct API output requires manual conversion

### OOM (Out of Memory)
**Solution**: Lower `--gpu-memory-utilization` to 0.7, or reduce `--max-model-len` to 16384

### Layout reports CUDA error, but CPU version of paddle is installed
**Cause**: Default `layout.device` is `cuda`.<br>
**Solution**: Add `--set layout.device=cpu` (GPU version doesn't need this)

### Layout reports missing `pypdfium2` / dependencies
**Solution**: Explicitly install `pip install "pypdfium2>=4"`; 0.2.3's `[all]` includes it, older source packages may lack it. pypdfium2 is required even for image-only inputs

## Network & Environment

### Internal network / container pip timeout
**Solution**: Switch to Tsinghua/Aliyun mirror; for localhost requests set `no_proxy=127.0.0.1,localhost,::1`

### Service on remote machine
**Solution**: `ssh -L 18499:127.0.0.1:18499 user@host`, frontend uses `VLLM_URL=http://127.0.0.1:18499`

### Insufficient disk space
**Requirement**: Two env sets + model require ≥20GB; switch to a larger disk if system/data disk is nearly full

## Environment Configuration

### Want to merge feat-ocr's two torch environments
**Note**: Merging is **optional**, only needed for dual-backend byte-for-byte verification. For service/parsing only, install just vLLM or transformers.<br>
**Solution**: If merging: first compile vLLM, then `pip install --no-deps -e <transformers_source>`, finally `pip install --no-deps accelerate`

---

For issues not covered here, refer to the [detailed tutorial](./minicpmvocr_tutorial_en.md) or open an issue on GitHub.
