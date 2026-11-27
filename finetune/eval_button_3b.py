"""3B 버튼 안내 평가: 기본 3B와 학습한 3B를 확인용 데이터(kiosk_val.json)로 앱과 같은 방식으로 채점한다.

- 1단계(버튼 고르기, system 문장이 있는 문항): 답 JSON의 steps[0].button이 정답과 같으면 '이름' 맞음.
  이름이 맞으면 앱처럼 2단계(위치 찾기)를 이어서 묻고, 상자 중심이 정답 상자 안이면 '위치'도 맞음.
- 2단계(위치 찾기 문항): 번호별 상자 중심이 정답 상자 안에 들어간 비율.
정답 상자는 같은 사진의 2단계 문항에서 가져온다(좌표는 줄인 사진 기준).
Ollama의 구조화 출력(JSON 스키마 강제)은 없이 그냥 생성한다. 그래서 기본 모델은 JSON을 못 지켜 조금 불리할 수 있다.

실행 (저장소 루트에서, 학습 venv로):
  python finetune/eval_button_3b.py --adapter C:/Code/quiz/kiosk_finetune/saves/qwen25vl-3b-button
결과: 화면 요약 + finetune/data/train-3b/eval_button_3b.json
"""
import argparse
import json
import re
from pathlib import Path

import torch
from peft import PeftModel
from PIL import Image
from transformers import AutoProcessor, BitsAndBytesConfig, Qwen2_5_VLForConditionalGeneration

ROOT = Path(__file__).resolve().parent.parent
BASE = "Qwen/Qwen2.5-VL-3B-Instruct"


def locate_prompt(steps):
    """lib/guide.ts의 buildLocateMessages와 같은 문장."""
    lines = [f'{i + 1}. "{s["button"]}" ({"probably a menu item card" if s.get("kind") == "menu" else "probably a button or tab"})'
             for i, s in enumerate(steps)]
    return "\n".join([
        "Find these elements on the kiosk screen by the text written on them. Each one is either a menu item card (picture, name and price) or a button/tab.",
        "Output their bbox coordinates in JSON format. For a menu item card, the box covers the whole card.",
        'Use the element number as the label, e.g. {"bbox_2d": [x1, y1, x2, y2], "label": "1"}.',
        *lines,
    ])


def parse_boxes(raw, n):
    """lib/guide.ts의 attachBoxes처럼 번호별 상자를 읽는다."""
    boxes = [None] * n
    for order, item in enumerate(re.findall(r'\{[^{}]*"bbox_2d"[^{}]*\}', raw)):
        m = re.search(r'"bbox_2d"\s*:\s*\[([^\]]*)\]', item)
        lab = re.search(r'"label"\s*:\s*"?\s*(\d+)', item)
        idx = int(lab.group(1)) - 1 if lab and 1 <= int(lab.group(1)) <= n else order
        try:
            nums = [float(x) for x in m.group(1).split(",")]
        except (AttributeError, ValueError):
            continue
        if idx < n and boxes[idx] is None and len(nums) == 4:
            boxes[idx] = nums
    return boxes


def inside(pred, gold):
    if not pred:
        return False
    cx, cy = (pred[0] + pred[2]) / 2, (pred[1] + pred[3]) / 2
    return min(gold[0], gold[2]) <= cx <= max(gold[0], gold[2]) and min(gold[1], gold[3]) <= cy <= max(gold[1], gold[3])


def parse_json(raw):
    m = re.search(r"\{.*\}", raw, re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None


def loose_steps(raw):
    """JSON이 깨졌을 때 "button": "..." 와 "kind": "..." 를 순서대로 뽑는다.
    앱은 Ollama 구조화 출력으로 JSON 모양을 강제하므로, 기본 모델도 이렇게 읽어 주는 것이 공정하다."""
    names = re.findall(r'"button"\s*:\s*"([^"]+)"', raw)
    kinds = re.findall(r'"kind"\s*:\s*"([^"]+)"', raw)
    return [{"button": n, "kind": kinds[i] if i < len(kinds) else "button"} for i, n in enumerate(names)]


@torch.no_grad()
def chat(model, proc, img, messages, max_new=400):
    msgs = []
    for m in messages:
        text = m["content"].replace("<image>", "")
        content = ([{"type": "image"}] if "<image>" in m["content"] else []) + [{"type": "text", "text": text}]
        msgs.append({"role": m["role"], "content": content})
    text = proc.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = proc(text=[text], images=[img], return_tensors="pt").to(model.device)
    out = model.generate(**inputs, max_new_tokens=max_new, do_sample=False)
    return proc.batch_decode(out[:, inputs.input_ids.shape[1]:], skip_special_tokens=True)[0].strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", help="없으면 기본 3B만")
    ap.add_argument("--data", default="finetune/data/train-3b")
    ap.add_argument("--pixels", type=int, default=313600)
    args = ap.parse_args()
    data_dir = ROOT / args.data
    val = json.loads((data_dir / "kiosk_val.json").read_text(encoding="utf-8"))

    # 정답 상자: (사진, 버튼 이름) → 상자
    gold_box = {}
    for s in val:
        if s["messages"][0]["role"] == "user":
            names = re.findall(r'^\d+\. "(.*)" \(probably', s["messages"][0]["content"], re.M)
            for name, box in zip(names, parse_boxes(s["messages"][1]["content"], len(names))):
                gold_box[(s["images"][0], name)] = box

    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(BASE, quantization_config=bnb, device_map="cuda:0")
    proc = AutoProcessor.from_pretrained(BASE, max_pixels=args.pixels)
    variants = {"base": None}
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter, adapter_name="tuned")
        variants["tuned"] = "tuned"
    model.eval()

    results, summary = [], {}
    for name, adapter in variants.items():
        ctx = model.disable_adapter() if adapter is None and args.adapter else None
        if ctx: ctx.__enter__()
        elif adapter: model.set_adapter(adapter)
        sc = {"guide": 0, "name": 0, "both": 0, "json_fail": 0, "loc_items": 0, "loc_ok": 0}
        for s in val:
            img = Image.open(data_dir / s["images"][0]).convert("RGB")
            msgs = s["messages"][:-1]
            gold = s["messages"][-1]["content"]
            raw = chat(model, proc, img, msgs)
            row = {"model": name, "image": s["images"][0], "q": msgs[-1]["content"][-120:], "gold": gold, "ai": raw}
            if msgs[0]["role"] == "system":
                sc["guide"] += 1
                g, p = json.loads(gold), parse_json(raw)
                gb = g["steps"][0]["button"]
                sc["json_fail"] += p is None
                steps = p["steps"] if p and isinstance(p.get("steps"), list) and p["steps"] else loose_steps(raw)
                pb = steps[0].get("button") if steps else None
                row["name_ok"] = pb == gb
                if row["name_ok"]:
                    sc["name"] += 1
                    loc = chat(model, proc, img, [{"role": "user", "content": "<image>" + locate_prompt(steps[:3])}], 200)
                    box = parse_boxes(loc, len(steps[:3]))[0]
                    row["locate"] = loc
                    row["pos_ok"] = inside(box, gold_box.get((s["images"][0], gb)) or [0, 0, 0, 0])
                    sc["both"] += row["pos_ok"]
            else:
                names = re.findall(r'^\d+\. "(.*)" \(probably', msgs[0]["content"], re.M)
                pred = parse_boxes(raw, len(names))
                ok = [inside(pb, gold_box[(s["images"][0], n)]) for n, pb in zip(names, pred)]
                sc["loc_items"] += len(ok)
                sc["loc_ok"] += sum(ok)
                row["loc_ok"] = ok
            results.append(row)
            print(f"[{name}] {row['image']} {'이름 ' + ('O' if row.get('name_ok') else 'X') if 'name_ok' in row else '위치 ' + str(row.get('loc_ok'))}", flush=True)
        if ctx: ctx.__exit__(None, None, None)
        summary[name] = sc

    print()
    for name, sc in summary.items():
        print(f"{name:6s} 1단계 {sc['guide']}문항: 이름 {sc['name']}/{sc['guide']}, 이름+위치 {sc['both']}/{sc['guide']}, JSON 실패 {sc['json_fail']}"
              f" | 2단계 상자 {sc['loc_ok']}/{sc['loc_items']}")
    (data_dir / "eval_button_3b.json").write_text(json.dumps({"summary": summary, "rows": results}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
