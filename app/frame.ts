/** AI에 보낼 사진. 화면에 그릴 때도 같은 사진을 써서 버튼 좌표가 정확히 겹치게 한다. */
export type Frame = { dataUrl: string; base64: string; width: number; height: number };

// Qwen2.5-VL은 28픽셀 단위로 이미지를 나눠 보므로 크기를 28의 배수로 맞추면
// 모델이 내놓는 픽셀 좌표가 우리가 보낸 사진의 좌표와 그대로 일치한다.
//
// Ollama는 보낸 사진 크기와 상관없이 이미지를 안쪽에서 일정 크기로 바꾸고, 모델은 그 크기 기준 좌표를 낸다.
// 작은 사진을 그대로 보내면 좌표가 사진 밖으로 나가 상자가 사라지므로, 약 110만 픽셀에 맞춰 키우거나 줄여 보낸다.
// (7B, 16문항: 긴 변 1024로 줄이기만 하면 위치 정확도 0%, 110만 픽셀로 맞추면 87.5%)
const TARGET_PIXELS = 1_100_000;
const MAX_SIDE = 1600;
const PATCH = 28;

function fitSize(width: number, height: number) {
  const scale = Math.min(Math.sqrt(TARGET_PIXELS / (width * height)), MAX_SIDE / Math.max(width, height));
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

export async function fileToFrame(file: File): Promise<Frame> {
  const bitmap = await createImageBitmap(file);
  try {
    return draw(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
