import { spawn } from "node:child_process";
import { dlopen, FFIType, ptr } from "bun:ffi";

// 검증 명령을 제 속도로 돌린다: bun scripts/full-speed.ts <명령> [인자…]
//
// Windows 11은 창이 없는 프로세스를 전원 조절 대상으로 보고, 사용자가 한동안 입력하지 않으면 효율 코어에만 올린다. 에이전트가 검증을
// 돌리는 때가 꼭 사용자가 자리를 비운 때라, 성능 코어는 쉬는데 테스트가 효율 코어 몇 개를 두고 줄을 선다(i7-12700에서 20개 가운데 4개.
// 화면 테스트 넷을 함께 돌리면 대기열이 180까지 쌓여 서버가 정적 파일을 수십 초 뒤에 주고, 테스트가 제한 시간에 걸린다).
// 이 조절은 프로세스마다 꺼야 하고 자식에게 물려지지 않는다. 그래서 명령을 띄운 뒤 그 아래에 생기는 프로세스를 지켜보며 하나씩 끈다
// (SetProcessInformation의 ProcessPowerThrottling). 시스템 설정은 건드리지 않고 이 명령 아래의 프로세스에만 닿으며, Windows가 아니면 명령만 돌린다.

/** 바깥에서 이미 지켜보고 있으면(npm run check 안의 npm test) 또 지켜보지 않는다. */
const NESTED = "RELAY_FULL_SPEED";
const WATCH_MS = 150;

const SNAP_PROCESS = 0x2, SET_INFORMATION = 0x0200, POWER_THROTTLING = 4;
/** PROCESSENTRY32W(x64): th32ProcessID는 8, th32ParentProcessID는 32에 있다. */
const ENTRY_SIZE = 568, ENTRY_PID = 8, ENTRY_PARENT = 32;
const INVALID_HANDLE = 0xffff_ffff_ffff_ffffn;

/** 이 프로세스와 그 아래에 생기는 프로세스의 전원 조절을 끈다. 그만 지켜보게 하는 함수를 돌려준다. */
function release(): () => void {
  if (process.platform !== "win32" || process.env[NESTED]) return () => {};
  try {
    const { symbols: kernel } = dlopen("kernel32.dll", {
      CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
      Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
      OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
      SetProcessInformation: { args: [FFIType.u64, FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    });
    // PROCESS_POWER_THROTTLING_STATE { Version 1, ControlMask EXECUTION_SPEED, StateMask 0 }: 실행 속도를 조절하지 않는다.
    const state = new Uint32Array([1, 1, 0]);
    const entry = new Uint8Array(ENTRY_SIZE), view = new DataView(entry.buffer);
    const free = (pid: number) => {
      const handle = kernel.OpenProcess(SET_INFORMATION, 0, pid);
      if (!handle) return;
      kernel.SetProcessInformation(handle, POWER_THROTTLING, ptr(state), state.byteLength);
      kernel.CloseHandle(handle);
    };
    // 끝난 프로세스도 남겨 둔다. 부모가 먼저 끝난 자식의 자식도 따라가기 위해서다.
    const tree = new Set<number>([process.pid]);
    free(process.pid);
    const tick = () => {
      const snapshot = kernel.CreateToolhelp32Snapshot(SNAP_PROCESS, 0);
      if (!snapshot || snapshot === INVALID_HANDLE) return;
      const pairs: [number, number][] = [];
      view.setUint32(0, ENTRY_SIZE, true);
      for (let more = kernel.Process32FirstW(snapshot, ptr(entry)); more; more = kernel.Process32NextW(snapshot, ptr(entry)))
        pairs.push([view.getUint32(ENTRY_PID, true), view.getUint32(ENTRY_PARENT, true)]);
      kernel.CloseHandle(snapshot);
      for (let grew = true; grew;) {
        grew = false;
        for (const [pid, parent] of pairs) if (!tree.has(pid) && tree.has(parent)) { tree.add(pid); free(pid); grew = true; }
      }
    };
    tick();
    const timer = setInterval(tick, WATCH_MS);
    return () => clearInterval(timer);
  } catch {
    // 조절을 끄지 못해도 명령은 돌린다(느릴 뿐이다).
    return () => {};
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: bun scripts/full-speed.ts <command> [args...]");
  process.exit(2);
}
const stop = release();
const env = { ...process.env, [NESTED]: "1" };
// Windows의 npm·playwright는 .cmd라 셸을 거쳐야 한다. 빈칸이나 한글이 든 인자(-g "메모 그래프")는 따옴표로 묶어 넘긴다.
const quote = (value: string) => (/^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`);
// cmd는 명령 이름의 /를 옵션으로 읽으므로(node_modules/bun/bin/bun.exe) 실행 파일 경로만 \로 바꾼다.
const child = process.platform === "win32"
  ? spawn([command.replace(/\//g, "\\"), ...args].map(quote).join(" "), { stdio: "inherit", shell: true, env })
  : spawn(command, args, { stdio: "inherit", env });
child.on("error", (error) => { stop(); console.error(String(error)); process.exit(1); });
child.on("exit", (code, signal) => { stop(); process.exit(code ?? (signal ? 1 : 0)); });
