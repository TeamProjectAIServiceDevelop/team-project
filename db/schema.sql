-- Neon Postgres. Neon 콘솔의 SQL Editor에서 한 번 실행한다.
-- 안내가 맞았는지 사용자가 누른 피드백. 개인정보 보호를 위해 사진·영상은 저장하지 않는다.
CREATE TABLE IF NOT EXISTS feedback (
  id         bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  goal       text NOT NULL,          -- 빈 문자열이면 목표 없이 둘러보기
  stage      text NOT NULL,          -- 모델이 판단한 화면 단계
  button     text NOT NULL,          -- 모델이 고른 버튼
  message    text NOT NULL,          -- 읽어 준 안내문
  correct    boolean NOT NULL,       -- 맞았어요 = true, 틀렸어요 = false
  mode       text NOT NULL CHECK (mode IN ('live', 'photo')),
  lang       text NOT NULL CHECK (lang IN ('ko', 'en'))
);
