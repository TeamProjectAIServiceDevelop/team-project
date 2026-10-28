/** AI에 보낼 사진. 화면에 그릴 때도 같은 사진을 써서 버튼 좌표가 정확히 겹치게 한다. */
export type Frame = { dataUrl: string; base64: string; width: number; height: number };

// Qwen2.5-VL은 28픽셀 단위로 이미지를 나눠 보므로 크기를 28의 배수로 맞추면
// 모델이 내놓는 픽셀 좌표가 우리가 보낸 사진의 좌표와 그대로 일치한다.
const MAX_SIDE = 1024;
const PATCH = 28;

function fitSize(width: number, height: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const round = (n: number) => Math.max(PATCH, Math.round((n * scale) / PATCH) * PATCH);
  return { width: round(width), height: round(height) };
}

function draw(source: CanvasImageSource, srcWidth: number, srcHeight: number): Frame {
  const { width, height } = fitSize(srcWidth, srcHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width, height };
}

export function captureFrame(video: HTMLVideoElement): Frame {
  return draw(video, video.videoWidth, video.videoHeight);
}

// 화면 변화 감지용 축소 흑백 이미지. 매번 AI에 보내지 않고 이것끼리 비교해서 바뀐 장면만 보낸다.
const SIG_WIDTH = 32;
const SIG_HEIGHT = 18;
let sigCanvas: HTMLCanvasElement | undefined;

export function signature(video: HTMLVideoElement): Uint8Array | null {
  if (video.videoWidth === 0) return null;
  sigCanvas ??= document.createElement("canvas");
  sigCanvas.width = SIG_WIDTH;
  sigCanvas.height = SIG_HEIGHT;
  const ctx = sigCanvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, SIG_WIDTH, SIG_HEIGHT);
  const { data } = ctx.getImageData(0, 0, SIG_WIDTH, SIG_HEIGHT);
  const gray = new Uint8Array(SIG_WIDTH * SIG_HEIGHT);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  }
  return gray;
}

/** 두 축소 이미지의 평균 밝기 차이(0~255). 클수록 많이 달라진 것이다. */
export function difference(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
