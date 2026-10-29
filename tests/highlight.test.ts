import { describe, expect, test } from "bun:test";
import { HIGHLIGHT_MAX_CHARS, renderCode, splitLines } from "../src/web/lib/highlight";
import { codeLanguage, fileType, viewerKind } from "../src/web/lib/files";

describe("Viewer syntax highlighting", () => {
  test("splitLines keeps every line a complete HTML fragment, reopening multi-line tokens", () => {
    const html = '<span class="hljs-comment">/* 첫\n둘째 */</span> <span class="hljs-keyword">const</span>\nend';
    expect(splitLines(html)).toEqual([
      '<span class="hljs-comment">/* 첫</span>',
      '<span class="hljs-comment">둘째 */</span> <span class="hljs-keyword">const</span>',
      "end",
    ]);
    expect(splitLines("")).toEqual([""]);
    expect(splitLines("a\n")).toEqual(["a", ""]);
  });

  test("renderCode colours known languages and escapes HTML", () => {
    const ts = renderCode('const a = "<b>";\n// 주석\n', "typescript");
    expect(ts.highlighted).toBe(true);
    expect(ts.lines).toBe(3);
    expect(ts.html.startsWith('<span class="viewer-line"><span class="viewer-text"><span class="hljs-keyword">const</span>')).toBe(true);
    expect(ts.html).toContain("&lt;b&gt;");
    expect(ts.html).toContain('<span class="hljs-comment">// 주석</span>');
    expect(ts.html).not.toContain("<b>");
    const json = renderCode('{"키": [1, true]}', "json");
    expect(json.html).toContain('<span class="hljs-attr">&quot;키&quot;</span>');
    expect(json.html).toContain('<span class="hljs-literal"><span class="hljs-keyword">true</span></span>');
  });

  test("renderCode falls back to plain numbered lines for unknown languages and huge files", () => {
    const plain = renderCode("a < b\nc", null);
    expect(plain).toEqual({ html: '<span class="viewer-line"><span class="viewer-text">a &lt; b</span></span><span class="viewer-line"><span class="viewer-text">c</span></span>', lines: 2, highlighted: false });
    expect(renderCode("x", "brainfuck").highlighted).toBe(false);
    const huge = renderCode("let x = 1;\n".repeat(HIGHLIGHT_MAX_CHARS / 11 + 1), "javascript");
    expect(huge.highlighted).toBe(false);
    expect(huge.html).not.toContain("hljs-");
  });

  test("codeLanguage maps extensions and bare names; viewerKind opens every text-like file", () => {
    expect(codeLanguage("app.tsx")).toEqual({ language: "typescript", label: "TypeScript (TSX)" });
    expect(codeLanguage("Main.java")).toEqual({ language: "java", label: "Java" });
    expect(codeLanguage("script.PY")).toEqual({ language: "python", label: "Python" });
    expect(codeLanguage("config.toml")).toEqual({ language: "ini", label: "TOML" });
    expect(codeLanguage("Dockerfile")).toEqual({ language: "dockerfile", label: "Dockerfile" });
    expect(codeLanguage("Dockerfile.dev")).toEqual({ language: "dockerfile", label: "Dockerfile" });
    expect(codeLanguage("CMakeLists.txt")).toEqual({ language: "makefile", label: "CMake" });
    expect(codeLanguage("notes.txt")).toBeNull();
    expect(codeLanguage("server.log")).toBeNull();
    for (const name of ["a.json", "b.ts", "c.java", "d.py", "e.csv", "Makefile", "README", "f.diff"]) expect(viewerKind({ name, kind: "file" })).toBe("text");
    expect(viewerKind({ name: "photo.jpg", kind: "file" })).toBe("image");
    expect(viewerKind({ name: "setup.exe", kind: "file" })).toBeNull();
    expect(viewerKind({ name: "src", kind: "directory" })).toBeNull();
    expect(fileType({ name: "Makefile", kind: "file" })).toMatchObject({ label: "Makefile", tone: "code", preview: "text" });
    expect(fileType({ name: "README", kind: "file" })).toMatchObject({ label: "텍스트 문서", tone: "text", preview: "text" });
  });
});
