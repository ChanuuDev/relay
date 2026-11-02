import { clip } from "./bubble";

/** 홀(대기)·로비(완료)에서 동료끼리 나누는 대화 대본과 고르는 규칙. 시뮬레이션은 여기서 고른 대본을 차례대로 말풍선에 띄운다. */

/** 말하는 사람: a 먼저 다가간(지나가는) 쪽, b 상대, c 셋째, all 다 함께 */
export type Speaker = "a" | "b" | "c" | "all";
/** 대화에 들어온 순서가 곧 역할이다. */
export const ROLES = { a: 0, b: 1, c: 2 } as const;
/** hop: 신나서 말하며 제자리에서 콩콩 뛴다. */
export interface Line { by: Speaker; text: string; hop: boolean }
/** pair: 다가가 둘이, group: 셋이 모여, pass: 걷다가 지나가며 인사, sendoff: 퇴근하는 동료를 로비에서 배웅 */
export type ChatKind = "pair" | "group" | "pass" | "sendoff";
export type ChatPlace = "hall" | "done";

/** 대본을 고를 때 보는 형편 */
export interface ChatContext {
  hour: number;
  /** 0 일요일 … 6 토요일 */
  day: number;
  /** a와 b가 전에 이야기해 본 사이 */
  met: boolean;
  /** a와 b가 같은 종류의 에이전트 */
  same: boolean;
  /** a, b가 세션을 끝내 곧 퇴근하는지 */
  leaving: readonly [boolean, boolean];
  /** 역할 순서대로 에이전트 이름과 세션 이름(없으면 빈 글자) */
  people: readonly { name: string; task: string }[];
}

export type Cond = "morning" | "lunch" | "afternoon" | "evening" | "night" | "monday" | "friday"
  | "first" | "again" | "same" | "other" | "aLeaving" | "bLeaving" | "named";

const CONDS: Record<Cond, (context: ChatContext) => boolean> = {
  morning: ({ hour }) => hour >= 6 && hour < 11,
  lunch: ({ hour }) => hour >= 11 && hour < 14,
  afternoon: ({ hour }) => hour >= 14 && hour < 18,
  evening: ({ hour }) => hour >= 18 && hour < 22,
  night: ({ hour }) => hour >= 22 || hour < 6,
  monday: ({ day }) => day === 1,
  friday: ({ day }) => day === 5,
  first: ({ met }) => !met,
  again: ({ met }) => met,
  same: ({ same }) => same,
  other: ({ same }) => !same,
  aLeaving: ({ leaving }) => leaving[0],
  bLeaving: ({ leaving }) => leaving[1],
  named: ({ people }) => Boolean(people[1]?.task),
};

export interface Script { id: string; when: readonly Cond[]; lines: readonly Line[] }

/**
 * 대본 한 편은 문자열 배열이다. `@조건`은 그 형편일 때만 고르고, 나머지는 `말하는 사람: 대사`이다.
 * 말하는 사람 뒤에 `!`를 붙이면 신나서 콩콩 뛴다. 대사의 {a} {b} {c}는 에이전트 이름, {bTask}는 세션 이름이다.
 * 이름 뒤에는 받침에 따라 바뀌는 조사를 붙이지 않는다(‘님’, ‘끼리’처럼 늘 같은 말만 쓴다).
 */
type Source = readonly string[];

const HALL_PAIR: Source[] = [
  ["a: 어떤 작업 맡으셨어요?", "b: 아직 배정 전이에요", "a: 저도요, 같이 기다려요"],
  ["a: 커피 한잔 할래요?", "b!: 좋아요, 가요!"],
  ["a: 어제 그 버그 봤어요?", "b: 봤어요, 고쳤대요", "a!: 다행이다!"],
  ["a: 오늘 리뷰 많네요", "b: 같이 힘내요!"],
  ["a: 로그 확인해 봤어요?", "b: 지금 보는 중이에요"],
  ["a: 다음 작업 뭐예요?", "b: 곧 알려 준대요", "a: 두근두근하네요"],
  ["b: 어, 무슨 일 있어요?", "a: 그냥 심심해서요", "b: ㅎㅎ 저도요"],
  ["a: 그 PR 보셨어요?", "b: 어떤 거요?", "a: 테스트 고친 거요", "b: 아, 깔끔하던데요"],
  ["a: 컨텍스트 넉넉해요?", "b: 아직 많이 남았어요", "a: 부럽다…"],
  ["a: 요즘 뭐로 짜요?", "b: TypeScript요", "a!: 오, 저도요!"],
  ["a: 저기요…", "b: 네?", "a: 아, 아니에요", "b: ?"],
  ["a: 탭이에요, 스페이스예요?", "b: 스페이스 두 칸요", "a: …우린 안 맞네요"],
  ["a: 빌드 얼마나 걸려요?", "b: 한 2분요?", "a: 그 정도면 양호하죠"],
  ["a: 그 버그 재현돼요?", "b: 제 쪽에선 잘 되는데요", "a: …다들 그러더라고요"],
  ["a: 머지 충돌 났어요", "b: 아이고…", "a: 금방 풀 거예요"],
  ["a: 함수 이름 정했어요?", "b: 아직 고민 중이에요", "a: 이름 짓기가 제일 어렵죠"],
  ["a: 문서는 누가 써요?", "b: …다음 세션이요?", "a!: ㅋㅋㅋ"],
  ["a: 테스트 몇 개예요?", "b: 300개 넘어요", "a: 든든하네요"],
  ["a: rebase 해 봤어요?", "b: 무서워서 못 했어요"],
  ["a: 오늘도 화이팅!", "b!: 화이팅!"],
  ["a: 배고프지 않아요?", "b: 토큰이 고파요"],
  ["b: 혹시 저 부르셨어요?", "a: 아뇨, 지나가다가요", "b: 아하"],
  ["a: 주석 다는 편이에요?", "b: 꼭 필요할 때만요", "a: 저도요"],
  ["a: 그 얘기 들었어요?", "b: 뭐요?", "a: 새 모델 나온대요", "b!: 진짜요?"],
  ["a: 오늘 할 일 많아요?", "b: 적당해요", "a: 적당한 게 최고죠"],
  ["a: …", "b: …", "a: 조용하네요", "b: 그러게요"],
  ["a: 키보드 소리 좋네요", "b: 기계식이에요", "a: 역시 손맛이죠"],
  ["a: 린트 경고 몇 개예요?", "b: 비밀이에요", "a: ㅋㅋ 많구나"],
  ["@morning", "a: 좋은 아침이에요!", "b: 커피부터 마실래요"],
  ["@morning", "a: 일찍 오셨네요", "b: 아침형이라서요", "a: 부지런하시다"],
  ["@lunch", "a: 점심 뭐 먹어요?", "b: 국밥 어때요?", "a!: 좋아요!"],
  ["@lunch", "a: 밥은 먹었어요?", "b: 아직요, 같이 가요"],
  ["@afternoon", "a: 졸리지 않아요?", "b: 커피 한 잔 더요…"],
  ["@afternoon", "a: 간식 먹을래요?", "b!: 오, 뭐 있어요?", "a: 초코파이요"],
  ["@evening", "a: 아직 안 가요?", "b: 이것만 하고요"],
  ["@evening", "a: 저녁 먹고 해요", "b: 좋아요, 배고파요"],
  ["@night", "a: 이 시간까지요?", "b: 야근이에요…", "a: 힘내요"],
  ["@night", "a: 졸려요…", "b: 저도요…", "a: 조금만 버텨요"],
  ["@monday", "a: 월요일이네요…", "b: 벌써요?"],
  ["@friday", "a!: 불금이에요!", "b: 배포만 없으면요", "a: …오늘 배포래요"],
  ["@first", "a: 처음 뵙겠습니다", "b: 반가워요, 잘 부탁해요", "a: 저도요!"],
  ["@first", "a: 새로 오셨어요?", "b: 네, 방금 왔어요", "a!: 환영해요!"],
  ["@again", "a: 또 만났네요", "b: 그러게요 ㅎㅎ"],
  ["@again", "a: 아까 그 얘기요", "b: 아, 어떻게 됐어요?", "a: 잘 풀렸어요"],
  ["@same", "a: 어, 같은 {a} 님이네요", "b!: 반가워요, 동료님!"],
  ["@same", "a: {a}끼리 모였네요", "b: 팀 회의라도 할까요?"],
  ["@other", "a: {b} 님은 일 어때요?", "b: 할 만해요", "a: 다음엔 같이 해요"],
  ["@other", "a: {b} 님 소문 들었어요", "b: 좋은 소문이죠?", "a: …아마도요"],
];

const HALL_GROUP: Source[] = [
  ["a: 다들 뭐 해요?", "b: 기다리는 중이에요", "c: 저도요", "a: 그럼 같이 기다려요"],
  ["a: 커피 마실 사람?", "b!: 저요!", "c!: 저도요!"],
  ["a: 이번 스프린트 어때요?", "b: 빡빡해요", "c: 그래도 할 만해요"],
  ["b: 어, 다 모였네요", "a: 회의할까요?", "c: 회의는 싫어요…", "all: ㅋㅋㅋ"],
  ["a: 점심 메뉴 정해요", "b: 짜장면", "c: 짬뽕", "a: …각자 먹어요"],
  ["a: 탭? 스페이스?", "b: 스페이스", "c: 탭", "a: 싸우지 마세요"],
  ["c: 무슨 얘기 해요?", "a: 버그 얘기요", "c: 그 버그요?", "b: 네, 그 버그요"],
  ["a: 누가 제일 빨라요?", "b: {c} 님이요", "c: 에이, 아니에요"],
  ["a: 다들 화이팅해요!", "all!: 화이팅!"],
  ["@lunch", "a: 밥 먹으러 가요", "b!: 좋아요!", "c: 저도 낄게요"],
  ["@friday", "a: 불금인데 뭐 해요?", "b: 쉬어요", "c: 저도 쉬어요", "a: 다들 쉬는구나"],
];

const HALL_PASS: Source[] = [
  ["a: 안녕하세요~", "b: 안녕하세요!"],
  ["a: 수고 많으세요", "b: 네~"],
  ["a: 커피 사 올게요", "b!: 제 것도요!"],
  ["a: 잠깐 지나갈게요", "b: 네, 가세요"],
  ["b: 어디 가요?", "a: 저쪽이요"],
  ["a: 오, {b} 님!", "b: 안녕하세요"],
  ["a: ♪", "b: 기분 좋아 보여요"],
  ["b: 바빠 보여요", "a: 조금요!"],
  ["@morning", "a: 굿모닝!", "b: 굿모닝~"],
  ["@again", "a: 또 봬요~", "b: ㅎㅎ 네"],
];

const DONE_PAIR: Source[] = [
  ["a: 오늘 고생 많았어요", "b: 수고하셨어요!"],
  ["a: 그 작업 끝났어요?", "b: 방금 끝냈어요", "a!: 축하해요!"],
  ["a: 퇴근하세요?", "b: 네, 곧 갈게요"],
  ["a: 내일 봐요!", "b: 들어가세요~"],
  ["a: 테스트 다 통과했죠?", "b: 네, 깔끔해요"],
  ["a: 저녁 뭐 먹어요?", "b!: 치킨이요!"],
  ["a: 커밋 메시지 잘 썼어요?", "b: 한 줄로 딱요"],
  ["a: 푸시까지 했어요?", "b!: 앗!", "a: ㅋㅋ 얼른 해요"],
  ["a: 오늘 몇 개 고쳤어요?", "b: 세 개요", "a: 저는 다섯 개요", "b: …자랑이죠?"],
  ["a: 리뷰 통과했어요?", "b!: 한 번에요!", "a: 대단해요"],
  ["a: 인계 노트 남겼어요?", "b: 꼼꼼하게요", "a: 역시"],
  ["a: 주말에 뭐 해요?", "b: 푹 쉬려고요"],
  ["a: 끝나니까 개운하네요", "b: 날아갈 것 같아요"],
  ["b: 먼저 가시는 거예요?", "a: 조금만 더 있다가요"],
  ["a: 버그 하나도 없죠?", "b: …아마도요", "a: 불안한데요"],
  ["a: 오늘 뭐 배웠어요?", "b: 정규식이요", "a: 고생했겠네요"],
  ["a: 빌드 초록불이죠?", "b!: 전부 초록이요!"],
  ["a: 다 끝났다!", "all!: 만세!"],
  ["a: 수고하셨습니다", "b: 수고하셨습니다", "all: ㅎㅎ"],
  ["a: 오늘 커밋 몇 개예요?", "b: 열 개 넘어요", "a: 와, 부지런하다"],
  ["a: 회고는 쓰셨어요?", "b: 내일 쓰려고요"],
  ["a: 집에 가서 뭐 해요?", "b: 아무것도 안 해요", "a: 그게 최고죠"],
  ["a: 오늘 제일 힘든 거요?", "b: 타입 에러요", "a: 아, 공감해요"],
  ["@named", "a: ‘{bTask}’ 끝났어요?", "b!: 네, 끝냈어요!"],
  ["@morning", "a: 아침부터 끝냈어요?", "b: 일찍 시작했거든요"],
  ["@lunch", "a: 점심 먹고 가요", "b: 좋아요, 제가 살게요"],
  ["@evening", "a: 늦게까지 고생했어요", "b: 덕분에 끝냈어요"],
  ["@night", "a: 막차 끊기겠어요", "b!: 얼른 가요!"],
  ["@monday", "a: 월요일부터 끝냈네요", "b: 한 주가 가볍겠어요"],
  ["@friday", "a!: 주말이다!", "b!: 푹 쉬어요!"],
  ["@bLeaving", "a: 곧 가시죠?", "b: 네, 짐 챙겨요", "a: 조심히 가요"],
  ["@bLeaving", "a: 벌써 퇴근이에요?", "b: 할 일 다 했거든요", "a!: 부럽다!"],
  ["@aLeaving", "a: 저 먼저 들어갈게요", "b: 조심히 가세요!"],
  ["@again", "a: 또 뵙네요", "b: 오늘 자주 마주치네요"],
  ["@same", "a: {a}끼리 수고했어요", "b: 우리 잘했죠?"],
  ["@other", "a: {b} 님 덕분이에요", "b: 에이, 같이 했죠"],
];

const DONE_GROUP: Source[] = [
  ["a: 다들 고생했어요!", "b: 수고했어요", "c: 수고하셨어요!"],
  ["a: 회식 갈 사람?", "b!: 저요!", "c: 저는 집에…", "a: 다음엔 꼭 와요"],
  ["a: 오늘 배포 성공!", "all!: 만세!"],
  ["b: 다 끝났어요?", "a: 네, 저는요", "c: 저도 방금요", "b!: 완벽해요"],
  ["a: 내일 뭐 해요?", "b: 리팩터링이요", "c: 저는 문서요", "a: 저는 쉬어요 ㅎㅎ"],
  ["a: 퇴근 인사 해요", "all: 수고하셨습니다!"],
  ["c: 다들 먼저 가요", "a: 같이 가요", "b: 기다릴게요"],
  ["a: 오늘 MVP는?", "b: {c} 님이요", "c!: 감사합니다!"],
  ["@night", "a: 다들 야근했네요", "b: 그래도 끝났잖아요", "c!: 집에 가요!"],
  ["@friday", "a!: 불금이다!", "b: 뭐 해요?", "c: 일단 자요", "all: ㅋㅋㅋ"],
];

const DONE_PASS: Source[] = [
  ["a: 수고했어요~", "b: 수고하셨어요!"],
  ["b: 내일 봐요!", "a: 네, 내일요!"],
  ["a: 오늘 잘했어요", "b!: 고마워요!"],
  ["a: 고생하셨어요", "b: 고생하셨어요~"],
  ["a: ♪♪", "b: 신나 보여요 ㅎㅎ"],
  ["b: 어디 가요?", "a: 바람 쐬러요"],
];

/** 퇴근하는 쪽(a)은 이미 ‘퇴근합니다!’ 인사를 띄우고 있으므로 배웅은 남는 쪽(b)만 말한다. */
const DONE_SENDOFF: Source[] = [
  ["b: 잘 가요~"], ["b: 수고했어요!"], ["b: 내일 봐요!"], ["b!: 조심히 들어가요!"], ["b: 부럽다…"],
  ["@night", "b: 푹 자요!"], ["@friday", "b!: 주말 잘 보내요!"],
];

const LINE = /^(a|b|c|all)(!?):\s*(.+)$/;

function parse(place: ChatPlace, kind: ChatKind, sources: readonly Source[]): Script[] {
  return sources.map((source, index) => {
    const when: Cond[] = [];
    const lines: Line[] = [];
    for (const item of source) {
      if (item.startsWith("@")) {
        const cond = item.slice(1) as Cond;
        if (!(cond in CONDS)) throw new Error(`알 수 없는 대화 조건: ${item}`);
        when.push(cond);
        continue;
      }
      const match = LINE.exec(item);
      if (!match) throw new Error(`대사 형식이 틀렸습니다: ${item}`);
      lines.push({ by: match[1] as Speaker, hop: match[2] === "!", text: match[3]! });
    }
    return { id: `${place}:${kind}:${index}`, when, lines };
  });
}

export const SCRIPTS: Record<ChatPlace, Record<ChatKind, readonly Script[]>> = {
  hall: { pair: parse("hall", "pair", HALL_PAIR), group: parse("hall", "group", HALL_GROUP), pass: parse("hall", "pass", HALL_PASS), sendoff: [] },
  done: {
    pair: parse("done", "pair", DONE_PAIR), group: parse("done", "group", DONE_GROUP),
    pass: parse("done", "pass", DONE_PASS), sendoff: parse("done", "sendoff", DONE_SENDOFF),
  },
};

/** 화면에 띄우는 에이전트 이름 */
const NAMES: Record<string, string> = { "claude-code": "Claude", codex: "Codex", grok: "Grok", "cursor-agent": "Cursor" };
export const agentName = (agent: string) => NAMES[agent] ?? agent;
/** 대사에 넣는 세션 이름. 이름이 없으면 빈 글자라 @named 대본을 고르지 않는다. */
export const taskName = (sessionName: string | null) => (sessionName ? clip(sessionName, 10) : "");

export const fits = (script: Script, context: ChatContext) => script.when.every((cond) => CONDS[cond](context));

/**
 * 형편에 맞는 대본 하나를 고른다. 형편을 타는 대본(시간·요일·사이)은 두 배로 자주 나오고,
 * 최근에 나온 대본은 다른 것이 남아 있는 한 다시 고르지 않는다.
 */
export function pickScript(scripts: readonly Script[], context: ChatContext, random: () => number, recent: readonly string[] = []) {
  const fitting = scripts.filter((script) => fits(script, context));
  const fresh = fitting.filter((script) => !recent.includes(script.id));
  const pool = fresh.length ? fresh : fitting;
  if (!pool.length) return null;
  const weight = (script: Script) => (script.when.length ? 2 : 1);
  let roll = random() * pool.reduce((sum, script) => sum + weight(script), 0);
  for (const script of pool) {
    roll -= weight(script);
    if (roll < 0) return script;
  }
  return pool.at(-1)!;
}

/** 대사의 이름 자리를 채운다. */
export function resolveLines(script: Script, context: ChatContext): Line[] {
  return script.lines.map((line) => ({
    ...line,
    text: line.text.replace(/\{(a|b|c)(Task)?\}/g, (_, role: "a" | "b" | "c", task?: string) => {
      const person = context.people[ROLES[role]];
      return (task ? person?.task : person?.name) ?? "";
    }),
  }));
}

/** 이 역할이 이 줄을 말하는가 */
export const speaks = (line: Line, role: number) => line.by === "all" || ROLES[line.by] === role;

/** 한 줄을 띄우는 초: 짧은 맞장구는 짧게, 긴 말은 읽을 만큼 길게 */
export const lineSeconds = (text: string) => Math.min(3.2, Math.max(1.2, 0.8 + Array.from(text).length * 0.12));
/** 말과 말 사이 숨 고르는 초 */
export const LINE_GAP = 0.25;
/** 마지막 말 뒤 마주 본 채 머무는 초 */
export const CHAT_TAIL = 0.6;

/** 줄마다 시작 시각(대화 시작부터 초)과 길이, 대화 전체 길이 */
export function timeline(lines: readonly Line[]) {
  const at: number[] = [], seconds: number[] = [];
  let time = 0;
  for (const line of lines) {
    at.push(time);
    seconds.push(lineSeconds(line.text));
    time += seconds.at(-1)! + LINE_GAP;
  }
  return { at, seconds, length: Math.max(0, time - LINE_GAP) + CHAT_TAIL };
}
