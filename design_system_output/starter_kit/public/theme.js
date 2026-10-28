/* 첫 페인트 전에 테마를 적용한다. CSP가 인라인 스크립트를 막아도 되도록 별도 파일로 동기 로드한다.
   저장 키는 src/lib/theme.ts의 THEME_KEY와 같아야 한다. 저장값이 없으면 다크가 기본이다. */
(function () {
  var root = document.documentElement, dark = true;
  try {
    var t = localStorage.getItem("app-theme");
    dark = t === "light" ? false : t === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
  } catch (e) {}
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
