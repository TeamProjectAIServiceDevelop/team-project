"""LoRA 어댑터를 원본 safetensors에 합친다. 샤드(파일) 하나씩 처리해서 RAM 16GB에서도 7B를 합칠 수 있다.
Ollama 0.40은 ADAPTER를 지원하지 않으므로, 학습 결과는 이렇게 합친 뒤 GGUF로 바꿔 넣는다.

사용: python merge_lora.py <원본 폴더> <어댑터 폴더> <출력 폴더>
"""
import json
import re
import shutil
import sys
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

base, adapter, out = map(Path, sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)

cfg = json.loads((adapter / "adapter_config.json").read_text(encoding="utf-8"))
scale = cfg["lora_alpha"] / cfg["r"]

# PEFT 이름(base_model.model.<원본 이름에서 .weight를 뺀 것>.lora_A.weight)을 원본 이름으로 바꾼다.
# transformers 버전에 따라 언어 모델이 model.layers 또는 model.language_model.layers로 저장되므로 둘 다 맞춘다.
lora: dict[str, dict[str, torch.Tensor]] = {}
with safe_open(adapter / "adapter_model.safetensors", "pt") as f:
    for key in f.keys():
        m = re.match(r"base_model\.model\.(.+)\.lora_([AB])\.weight$", key)
        if not m:
            raise SystemExit(f"모르는 어댑터 항목: {key}")
        lora.setdefault(m.group(1) + ".weight", {})[m.group(2)] = f.get_tensor(key)


def alias(name: str) -> list[str]:
    return [name, name.replace("model.language_model.", "model."), name.replace("model.", "model.language_model.", 1)]


used = set()
for shard in sorted(base.glob("*.safetensors")):
    tensors = {}
    with safe_open(shard, "pt") as f:
        meta = f.metadata()
        for key in f.keys():
            t = f.get_tensor(key)
            hit = next((a for a in alias(key) if a in lora), None)
            if hit:
                ab = lora[hit]
                delta = (ab["B"].float() @ ab["A"].float()) * scale
                t = (t.float() + delta).to(t.dtype)
                used.add(hit)
            tensors[key] = t
    save_file(tensors, out / shard.name, metadata=meta)
    print(f"{shard.name}: {len(tensors)}개")
    del tensors

missing = set(lora) - used
if missing:
    raise SystemExit(f"원본에서 못 찾은 어댑터 항목 {len(missing)}개, 예: {sorted(missing)[:3]}")
for f in base.iterdir():
    if f.suffix != ".safetensors" and f.is_file():
        shutil.copy2(f, out / f.name)
print(f"합침: 어댑터 {len(used)}개 항목, scale {scale}")
