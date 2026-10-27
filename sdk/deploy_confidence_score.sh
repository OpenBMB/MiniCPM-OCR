#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:-local}"
SDK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "$TARGET" == local ]]; then
  exec bash "$SDK_DIR/webui/scripts/start_webui.sh"
fi
: "${OCR_REMOTE_SDK_DIR:?Set OCR_REMOTE_SDK_DIR to the SDK directory on the remote host}"
printf -v quoted_remote '%q' "$OCR_REMOTE_SDK_DIR"
scp -C "$SDK_DIR/webui/static/index.html" "$TARGET:$OCR_REMOTE_SDK_DIR/webui/static/index.html"
ssh "$TARGET" "cd $quoted_remote && bash webui/scripts/start_webui.sh"
