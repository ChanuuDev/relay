// 세션 타입과 API 응답 모양은 로컬 서버·원격 서버·화면이 함께 쓰는 공용 코어에 있다.
export {
  SESSION_STATUSES, STATUS_LABELS, WEB_END_REASON, brief,
  type SessionStatus, type GitClue, type Compaction, type Session, type SessionUpdate, type NewSession,
  type SessionAction, type Filters, type Page, type ChainNode, type BriefSession,
  type SessionResult, type SessionChanged, type SessionDeleted, type SessionEnded, type SessionDetail, type HistoryPage,
  type SessionShown, type SessionPacket, type SessionLatest, type SessionList, type SessionChain, type SessionChainById,
  type SessionUpdates, type SessionChildren,
} from "@relay/core";
