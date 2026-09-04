#!/usr/bin/env bash
# Builds the free-tier models:
#  - BiRefNet swin_v1_tiny (MIT) fp16 for WebGPU, from ZhengPeng7/BiRefNet GitHub release v1
#  - IS-Net (Apache-2.0) int8 for WASM, from rembg's GitHub release
# Needs python3 with: pip install onnx onnxruntime onnxconverter-common sympy
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/models .cache
[ -f .cache/isnet.onnx ] || curl -L -o .cache/isnet.onnx https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx
[ -f .cache/birefnet-tiny.onnx ] || curl -L -o .cache/birefnet-tiny.onnx https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx
python3 - <<'PY'
import onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
from onnxconverter_common import float16
m = onnx.load('.cache/isnet.onnx')
outs = [o for o in m.graph.output if o.name == 'output_image']; del m.graph.output[:]; m.graph.output.extend(outs)
onnx.save(m, '.cache/isnet-1out.onnx')
onnx.save(float16.convert_float_to_float16(onnx.load('.cache/birefnet-tiny.onnx'), keep_io_types=True), 'public/models/birefnet-tiny-fp16.onnx')  # slow: ~3-5 min
quantize_dynamic('.cache/isnet-1out.onnx', 'public/models/isnet-int8.onnx', weight_type=QuantType.QUInt8)
print('models written to public/models')
PY
