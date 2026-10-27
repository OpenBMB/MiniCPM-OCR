# SDK 发布到 PyPI

[← 返回首页](../README_zh.md)

SDK 源码保留在官方仓库 [OpenBMB/MiniCPM-OCR](https://github.com/OpenBMB/MiniCPM-OCR) 的 `sdk/`。PyPI 发行包名为 `minicpm-ocr`，Python 导入名和命令均为 `minicpmvocr`。版本号统一维护在 [`sdk/minicpmvocr/_version.py`](../sdk/minicpmvocr/_version.py)。

本仓库当前没有内置的 PyPI 自动发布工作流；推送代码或 SDK 标签不会自动上传包。以下步骤供项目维护者手动构建、检查和发布。

## 构建与检查

发布前更新版本号并提交代码。在仓库根目录运行以下命令，确保 `sdk/dist/` 只保留本次版本的构建产物：

```bash
python -m pip install --upgrade build twine
python -m build sdk --outdir sdk/dist
python -m twine check --strict sdk/dist/*
```

构建完成后，在独立 Python 环境中安装生成的 wheel，检查 `minicpmvocr --help` 和 `minicpmvocr list-backends` 能否正常运行。

## 手动上传

确认构建结果后，由拥有 `minicpm-ocr` 项目发布权限的维护者运行：

```bash
python -m twine upload sdk/dist/*
```

按提示提供 PyPI API Token。上传方式见 [PyPA 官方发布教程](https://packaging.python.org/en/latest/tutorials/packaging-projects/#uploading-the-distribution-archives)。同一版本不能覆盖上传，后续发布需递增版本号。

确认 [PyPI 项目页](https://pypi.org/project/minicpm-ocr/) 出现对应版本后，即可安装。以下以 `1.0.0` 为例：

```bash
python -m pip install "minicpm-ocr[all]==1.0.0"
```

PaddlePaddle GPU 运行时需单独安装，具体命令见[安装与推理教程](./minicpmvocr_tutorial.md#1-sdk-环境配置)。
