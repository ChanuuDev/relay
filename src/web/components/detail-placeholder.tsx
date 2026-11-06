import { Inbox } from "lucide-react";

/** 2단 모드에서 선택이 없을 때 상세 자리를 채우는 안내. */
export function DetailPlaceholder() {
  return <div className="detail-placeholder">
    <Inbox aria-hidden="true" />
    <p>세션을 선택하면 요약과 기록 이력이 여기에 표시됩니다.</p>
    <p className="placeholder-hint"><kbd>/</kbd> 키로 바로 검색할 수 있습니다.</p>
  </div>;
}
