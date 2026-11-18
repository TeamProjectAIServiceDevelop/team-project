# 학습 결과를 바탕화면 "키오스크_집으로" 폴더에 복사한다. 집에 가져가서 이어 하기 위한 것이다.
# 학습이 끝나기 전에 실행해도 된다(그때까지 저장된 마지막 저장본을 복사한다).
#
# 실행: powershell -ExecutionPolicy Bypass -File finetune\pack-results.ps1
#
# 복사하는 것
#  - 마지막 저장본(checkpoint-N) 폴더: 어댑터 + 옵티마이저 상태. resume_from_checkpoint로 이어서 학습할 수 있다.
#  - 학습이 끝났다면 최종 어댑터(adapter_model.safetensors, adapter_config.json)와 손실 그래프·기록
#  - 학습 로그(train-kiosk-7b.log)

$ErrorActionPreference = "Stop"
$saves = "C:\Users\User\llamafactory\saves\kiosk-7b-qlora"
$dst = Join-Path ([Environment]::GetFolderPath("Desktop")) "키오스크_집으로\3_학습결과"
if (-not (Test-Path $saves)) { Write-Host "학습 결과 폴더가 없어요: $saves"; exit 1 }
New-Item -ItemType Directory -Force $dst | Out-Null

$last = Get-ChildItem $saves -Directory -Filter "checkpoint-*" | Sort-Object { [int]($_.Name -replace "checkpoint-", "") } | Select-Object -Last 1
if ($last) {
  Copy-Item -Recurse -Force $last.FullName $dst
  Write-Host "마지막 저장본: $($last.Name)"
} else {
  Write-Host "아직 저장본이 없어요(20단계마다 저장된다)."
}

$final = "adapter_model.safetensors", "adapter_config.json", "trainer_log.jsonl", "all_results.json", "train_results.json", "eval_results.json", "training_loss.png", "training_eval_loss.png", "trainer_state.json"
$copied = 0
foreach ($f in $final) {
  $p = Join-Path $saves $f
  if (Test-Path $p) { Copy-Item -Force $p $dst; $copied++ }
}
Write-Host "최종 결과 파일: $copied 개 (학습이 끝나야 생긴다)"

$log = "C:\Users\User\llamafactory\train-kiosk-7b.log"
if (Test-Path $log) { Copy-Item -Force $log $dst }

$size = (Get-ChildItem -Recurse $dst | Measure-Object -Sum Length).Sum / 1MB
Write-Host ("복사함: {0} ({1:N0} MB)" -f $dst, $size)
