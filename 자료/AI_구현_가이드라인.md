# AI 구현 가이드라인 (Qwen2.5-VL 3B)

2026-11-04 · 이동건, 정윤서

AI 모델은 **Qwen2.5-VL 3B**로 정했다. 이 문서는 RTX 3060 PC에서 모델을 띄우고 앱에 연결하는 방법, 그리고 Sprint 3의 LoRA 파인튜닝 방법을 정리한다.

## 1. 전체 구조

Ollama가 3060 PC에서 Qwen 모델을 띄우고, 앱은 이미 Ollama를 부르도록 만들어져 있다([lib/ollama.ts](../lib/ollama.ts)). 코드는 거의 바꾸지 않고 설치와 환경변수만 맞추면 된다.

```
휴대폰(웹) → Vercel(/api/guide, /api/menu) → Tunnel 주소 → 3060 PC의 Ollama → Qwen2.5-VL 3B
```

## 2. 모델 실행

### 2.1 Ollama 설치 (3060 PC)

[ollama.com](https://ollama.com)에서 Windows용을 받아 설치한다. 설치하면 백그라운드에서 `http://localhost:11434`로 실행된다.

### 2.2 모델 받기

```powershell
ollama pull qwen2.5vl:3b
ollama list          # 목록에 qwen2.5vl:3b가 보이면 성공
```

내려받는 크기는 약 3GB다.

### 2.3 모델만 따로 테스트

앱에 붙이기 전에 모델이 사진을 읽는지 먼저 확인한다. 질문 뒤에 사진 경로를 적으면 같이 읽는다.

```powershell
ollama run qwen2.5vl:3b
>>> 이 화면에 보이는 버튼 글자를 모두 알려 줘 C:\사진\kiosk.jpg
```

- 한글 버튼 이름이 나오면 성공이다.
- `nvidia-smi`로 GPU 메모리를 쓰는지 확인한다. GPU를 안 쓰면 아주 느리다.

## 3. 앱에 연결

### 3.1 PC에서 먼저 확인

프로젝트의 `.env.local`:

```
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5vl:3b
KIOSK_AI_MOCK=0
```

`npm run dev`를 실행하고 PC 브라우저에서 `http://localhost:3000`을 연다. localhost에서는 카메라가 허용되므로, 웹캠이나 모니터에 띄운 키오스크 사진으로 실제 안내가 나오는지 확인한다.

### 3.2 휴대폰에서 쓰기 (Tunnel + Vercel)

휴대폰 카메라는 HTTPS에서만 열리므로 Vercel 배포 주소로 쓴다. Vercel이 3060 PC에 접근하도록 Cloudflare Tunnel을 연다.

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:11434 --http-host-header="localhost:11434"
```

출력에 나오는 `https://xxxx.trycloudflare.com` 주소를 Vercel 환경변수에 넣고 다시 배포한다.

```
OLLAMA_URL=https://xxxx.trycloudflare.com
OLLAMA_MODEL=qwen2.5vl:3b
KIOSK_AI_MOCK=0
```

주의할 점:

- 임시 Tunnel 주소는 **cloudflared를 다시 켤 때마다 바뀐다.** 바뀌면 Vercel 값을 고치고 다시 배포한다. 시연 전에는 고정 주소(Cloudflare 계정 + 이름 있는 Tunnel)로 바꾼다.
- 시연하는 동안 PC를 켜 두고 절전 모드를 끈다.
- Tunnel 주소를 아는 사람은 누구나 Ollama를 쓸 수 있으므로 주소를 공개하지 않는다.

## 4. LoRA 파인튜닝 (Sprint 3)

LoRA는 모델 전체가 아니라 작은 어댑터 층만 더해 학습하는 방법이다. 바뀌는 값이 전체의 1% 안팎이라 개인 GPU로도 할 수 있다.

### 4.1 3060에서 가능한 범위

데스크톱 RTX 3060(12GB) 기준이다. 8GB 모델이면 3B QLoRA까지만 현실적이다. 메모리 크기는 `nvidia-smi`로 확인한다.

| 모델 | 방식 | 가능 여부 |
| --- | --- | --- |
| Qwen2.5-VL 3B | QLoRA (4비트) | ✅ 여유 있음 |
| Qwen2.5-VL 3B | LoRA (16비트) | 🔶 사진 해상도를 낮추면 가능 |
| Qwen2.5-VL 7B | QLoRA (4비트) | 🔶 빠듯함, 메모리 부족 가능 |
| Qwen2.5-VL 7B | LoRA (16비트) | ❌ 부족 |

추론(실제 안내)은 학습보다 메모리를 훨씬 적게 써서 문제없다.

### 4.2 학습 데이터

A4 라벨링 형식을 그대로 학습 데이터로 쓴다. 사진 한 장마다 "질문 → 정답 JSON" 한 쌍을 만든다.

```json
{
  "image": "store03_012.jpg",
  "messages": [
    {"role": "system", "content": "(buildMessages의 system 문구)"},
    {"role": "user", "content": "<image>목표: 아이스 아메리카노 포장\n지금까지 누른 버튼: 커피\n다음에 누를 버튼을 알려 줘."},
    {"role": "assistant", "content": "{\"stage\":\"메뉴 선택\",\"button\":\"아메리카노\",\"where\":\"화면 왼쪽 위\",\"box\":[120,340,410,520],\"message\":\"...\",\"done\":false}"}
  ]
}
```

- 실제 서비스와 같은 프롬프트를 쓴다([lib/guide.ts](../lib/guide.ts)의 `buildMessages`).
- 사진 한 장에 목표를 여러 개 붙여 데이터를 늘린다.
- **매장 단위로 나눈다.** 예: 10곳 중 7곳은 학습, 3곳은 평가. 학습 매장 사진이 평가에 섞이면 점수가 부풀려진다.

### 4.3 학습 도구

| 도구 | 특징 |
| --- | --- |
| **Unsloth** | 메모리를 적게 쓰고 빠르다. 3060에 가장 유리하다. |
| LLaMA-Factory | 설정 파일만 쓰면 되고 웹 화면이 있다. |
| ms-swift | Qwen 개발사 쪽 도구로 Qwen 지원이 가장 빠르다. |

### 4.4 3060용 설정 (LLaMA-Factory 예시)

```yaml
model_name_or_path: Qwen/Qwen2.5-VL-3B-Instruct
finetuning_type: lora
quantization_bit: 4              # QLoRA
lora_rank: 8
lora_target: all
dataset: kiosk_train
template: qwen2_vl
num_train_epochs: 3
learning_rate: 1.0e-4
per_device_train_batch_size: 1
gradient_accumulation_steps: 16
gradient_checkpointing: true     # 속도 대신 메모리 절약
image_max_pixels: 401408         # 약 640×640, 메모리가 부족하면 더 낮춤
bf16: true
cutoff_len: 2048
output_dir: saves/kiosk-lora-3b
```

- 메모리는 사진 해상도의 영향을 가장 크게 받는다.
- 학습 해상도와 실제로 보내는 장면 크기를 비슷하게 맞춰야 좌표가 어긋나지 않는다.
- 학습 중에는 GPU를 쓰는 다른 프로그램(Ollama, 브라우저 하드웨어 가속)을 끈다.
- 사진 수백 장, 3에폭 기준 대략 1~3시간이다. 먼저 20장 정도로 돌려 한 스텝의 시간과 메모리를 잰다.

### 4.5 평가

A5 평가 스크립트로 **학습에 쓰지 않은 매장** 사진을 넣고 "3B 원본 / 3B + LoRA"를 같은 표에 놓는다. 7B 원본 결과를 함께 넣으면 "작은 모델도 학습하면 큰 모델만큼 한다"는 비교가 된다. 7B가 필요하면 같은 설정으로 Colab이나 RunPod에서 몇 시간만 빌려 돌린다.

### 4.6 앱에 붙이기

1. 어댑터를 원래 모델에 합친다(LLaMA-Factory `export`).
2. 합친 모델을 GGUF로 바꿔 Modelfile로 Ollama에 `qwen2.5vl-kiosk:3b` 같은 이름으로 등록하고, `OLLAMA_MODEL`만 바꾼다.
3. **비전 모델은 GGUF 변환이 잘 안 될 수 있으므로 LoRA 작업을 시작할 때 이것부터 확인한다.** 막히면 vLLM으로 띄우고(OpenAI 호환 API) `lib/ollama.ts` 옆에 호출 파일을 하나 더 만든다.

## 5. 남은 정리

- 저장소 기본값은 아직 7B다: `.env.example`의 `OLLAMA_MODEL`, `lib/ollama.ts`의 기본값. 3B로 바꾼다.
- [8조_구현계획.md](8조_구현계획.md)의 A1·A6 등 7B 관련 내용을 3B 기준으로 고친다.
