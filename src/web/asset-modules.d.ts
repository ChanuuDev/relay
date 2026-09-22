// Bun 로더용 모듈 선언. `type: "text"`는 문자열, `type: "file"`은 실행 파일에 포함된 경로를 준다.
declare module "*theme.js" { const text: string; export default text; }
declare module "*.jpg" { const path: string; export default path; }
declare module "*.png" { const path: string; export default path; }
declare module "*.woff2" { const path: string; export default path; }
