# 파인튜닝 (Qwen2.5-VL-7B QLoRA)

앱의 두 질문(버튼 고르기, 위치 찾기)을 그대로 학습시켜 버튼 이름·위치 정확도를 올리는 작업이다. 진행 기록과 수치는 `자료/이동건-작업메모.md`의 "파인튜닝" 절에 있다.

## 순서

| 단계 | 명령 | 결과 |
| --- | --- | --- |
| 1. 상자 초안 | `node finetune/draft-boxes.ts` | `data/boxes/labels.jsonl` (draft: true) |
| 2. 상자 확인 | `npm run label -- --data finetune/data/boxes` | 초안 확인·수정 (`eval/README.md`) |
| 3. 학습 데이터 | `node finetune/build-train.ts` | `data/train/kiosk_train.json`, `kiosk_val.json`, `images/` |
| 4. 학습 | 아래 "학습" | `C:/Users/User/llamafactory/saves/kiosk-7b-qlora` |
| 5. 합치기 | `python finetune/merge_lora.py <원본> <어댑터> <출력>` | 합친 safetensors |
| 6. Ollama에 넣기 | 아래 "Ollama에 넣기" | `ollama create` |
| 7. 비교 | 49문항 평가 | 기준: 변환한 원본 7B `kiosk-7b-conv` 둘 다 30/49 |

사진(`data/*/images/`)은 블로그 사진이 섞여 있어 저장소에 올리지 않는다.

## 학습 환경 (이 PC에 설치한 방법)

기본 Python(3.10)의 torch는 CPU 판이고 LLaMA-Factory 최신판은 Python 3.11 이상이 필요해서, 따로 만들었다. 기본 Python은 건드리지 않는다.

```powershell
cd C:\Users\User\llamafactory
# uv(Astral)로 Python 3.11과 venv를 이 폴더 안에 만든다
$env:UV_PYTHON_INSTALL_DIR = "C:\Users\User\llamafactory\python"; $env:UV_CACHE_DIR = "C:\Users\User\llamafactory\uv-cache"
.\uv\uv.exe python install 3.11
.\uv\uv.exe venv --python 3.11 venv
.\uv\uv.exe pip install --python venv\Scripts\python.exe torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
git clone --depth 1 https://github.com/hiyouga/LLaMA-Factory.git
"torch==2.14.1+cu126" | Out-File -Encoding ascii keep-torch.txt   # 위에서 깐 CUDA torch를 바꾸지 않게
.\uv\uv.exe pip install --python venv\Scripts\python.exe -c keep-torch.txt -e .\LLaMA-Factory -r LLaMA-Factory\requirements\bitsandbytes.txt
```

설치된 버전(2026-11-18): torch 2.14.1+cu126, transformers 5.17.0, peft 0.18.1, trl 0.24.0, bitsandbytes 0.50.2, LLaMA-Factory 0.9.6.dev0.
원본 모델은 Hugging Face 캐시(`C:\Users\User\.cache\huggingface`)에 받아 두었다.

## 학습

저장소 루트에서 실행한다. 학습 중에는 GPU를 다 쓰므로 Ollama(배포 앱의 AI 포함)가 느려지거나 실패할 수 있다.

```powershell
cd C:\kiosk
$env:PYTHONUTF8 = "1"; $env:HF_HUB_OFFLINE = "1"
C:\Users\User\llamafactory\venv\Scripts\llamafactory-cli.exe train finetune\kiosk_qlora_7b.yaml
```

- RTX 3060 12GB에서 한 샘플에 약 6초. 739개 × 2번이면 2시간 반 정도.
- 3단계 시험 실행으로 확인한 것: 사진이 1,200토큰(840×1120 그대로)으로 들어가고, system 문장이 없는 위치 질문은 Ollama와 같은 "You are a helpful assistant."가 붙고, 손실은 답 부분에만 걸린다.
- transformers 5.17은 `warmup_ratio`를 받지 않아 `warmup_steps`를 쓴다.

## Ollama에 넣기

Ollama 0.40.12는 `ADAPTER`(LoRA)를 지원하지 않는다. 합친 뒤 GGUF로 바꿔 넣는다(llama.cpp 저장소의 변환 스크립트, Ollama에 들어 있는 `llama-quantize.exe`).

```powershell
python finetune\merge_lora.py <원본 snapshot 폴더> <어댑터 폴더> merged
python llama.cpp\convert_hf_to_gguf.py merged --outtype f16 --outfile model-f16.gguf
python llama.cpp\convert_hf_to_gguf.py merged --mmproj --outtype f16 --outfile mmproj.gguf
& "$env:LOCALAPPDATA\Programs\Ollama\lib\ollama\llama-quantize.exe" model-f16.gguf model-q4km.gguf Q4_K_M
# Modelfile: FROM ./model-q4km.gguf / FROM ./mmproj.gguf / 기존 qwen2.5vl:7b의 TEMPLATE
ollama create kiosk-7b-ft -f Modelfile
```
