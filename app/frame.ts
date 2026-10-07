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

export async function fileToFrame(file: File): Promise<Frame> {
  const bitmap = await createImageBitmap(file);
  try {
    return draw(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
