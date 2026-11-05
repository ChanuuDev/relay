# 설치 파일

저장소 루트에서 `npm run build` 후 `npm run dist -w @relay/desktop`을 실행하면 설치 배포물을 이 폴더에 모읍니다.

- `Relay-Setup-1.0.0.exe`: Windows용 Electron 앱 설치 파일입니다.
- `Relay-Setup-1.0.0.exe.blockmap`: 설치 파일 업데이트에 사용하는 메타데이터입니다.
- `relay.exe`: CLI와 로컬 웹 서버가 들어 있는 단독 실행 파일입니다.
- `install.cmd`: 같은 폴더의 CLI를 설치합니다. 훅·스킬·Windows 프로토콜도 등록합니다.
- `install-cli.ps1`: PowerShell에서 설치 옵션을 지정할 때 사용합니다.

Electron 앱을 쓰려면 Setup EXE를 실행하세요. CLI만 쓰려면 이 폴더의 `install.cmd`를 실행하세요. `relay.exe`와 설치 스크립트는 같은 폴더에 두세요.

실행 파일과 생성된 설치 스크립트는 Git에 넣지 않습니다. 개발·검증용 중간 산출물은 `dist/`에 남습니다.
