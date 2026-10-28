"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { captureFrame, difference, signature, type Frame } from "./frame";

// 아래 값은 실제 매장에서 다시 맞춰야 한다. 단위는 축소 흑백 이미지의 평균 밝기 차이(0~255).
const CHECK_MS = 500; // 화면을 비교하는 간격
const MOVING = 10; // 직전 비교보다 이만큼 달라지면 휴대폰이 움직이는 중
const CHANGED = 14; // 마지막으로 분석한 장면보다 이만큼 달라지면 새 장면
const STEADY_CHECKS = 2; // 이만큼 연속으로 멈춰 있어야 보낸다

type Options = {
  enabled: boolean;
  /** 앞 요청이 끝나기 전에는 새 장면을 보내지 않는다. */
  busy: boolean;
  onScene: (frame: Frame) => void;
};

/**
 * 실시간 카메라에서 분석할 장면을 고른다. 찍기 버튼 없이, 휴대폰이 멈춰 있고
 * 마지막으로 분석한 장면과 달라졌을 때만 onScene을 부른다.
 */
export function useLiveCamera(videoRef: RefObject<HTMLVideoElement | null>, { enabled, busy, onScene }: Options) {
  const [moving, setMoving] = useState(false);
  const lastSent = useRef<Uint8Array | null>(null);
  const busyRef = useRef(busy);
  const onSceneRef = useRef(onScene);

  useEffect(() => {
    busyRef.current = busy;
    onSceneRef.current = onScene;
  });

  useEffect(() => {
    if (!enabled) return;
    let previous: Uint8Array | null = null;
    let steady = 0;
    const id = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const sig = signature(video);
      if (!sig) return;
      const isMoving = previous === null || difference(sig, previous) > MOVING;
      previous = sig;
      setMoving(isMoving);
      steady = isMoving ? 0 : steady + 1;
      if (steady < STEADY_CHECKS || busyRef.current) return;
      if (lastSent.current && difference(sig, lastSent.current) <= CHANGED) return;
      lastSent.current = sig;
      onSceneRef.current(captureFrame(video));
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [enabled, videoRef]);

  /** 화면이 그대로여도 다음에 멈춘 장면을 다시 보낸다 (오류 뒤 재시도, 처음 시작할 때). */
  function rescan() {
    lastSent.current = null;
  }

  return { moving, rescan };
}
