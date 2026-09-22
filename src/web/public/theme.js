/* 첫 페인트 전에 테마를 적용한다. CSP가 인라인 스크립트를 막으므로 별도 자산으로 동기 로드한다. */
(function () {
  var root = document.documentElement, dark = true;
  try {
    var t = localStorage.getItem("relay-theme");
    dark = t === "light" ? false : t === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
  } catch (e) {}
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
})();
