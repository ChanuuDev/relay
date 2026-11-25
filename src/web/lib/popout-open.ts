import { useDesktop } from "./desktop-store";
import { handOff } from "./notes";
import { useNoteAlert } from "./note-images";
import { openPopout, type PopoutApp, type PopoutResult } from "./popout";

const BLOCKED = "브라우저가 새 창을 막았습니다. 주소창의 팝업 차단 표시에서 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.";

/** app을 바탕화면 밖 별도 창으로 옮긴다(메모 창 상단바·Dock 메뉴가 함께 쓴다).
 *  메모는 보던 메모와 보내지 못한 변경을 먼저 넘긴다. 열리면 바탕화면 안의 창은 닫아 두 곳에서 같은 메모를 고치지 않게 하고,
 *  브라우저가 팝업을 막으면 바탕화면 안에 창을 열고 허용 방법을 알린다. */
export function popOut(app: PopoutApp): PopoutResult {
  if (app === "notes") void handOff();
  const result = openPopout(app);
  if (result === "blocked") {
    useDesktop.getState().focus(app);
    if (app === "notes") useNoteAlert.getState().say(BLOCKED);
  } else useDesktop.getState().close(app);
  return result;
}
