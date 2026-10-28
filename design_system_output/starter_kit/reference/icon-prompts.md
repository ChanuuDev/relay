# 앱 아이콘 만들기 — 프롬프트와 후처리

Dock·메뉴·상단바에 쓰는 앱 아이콘은 **256px PNG, squircle 타일(n=5 superellipse, 캔버스의 약 89–92%), 투명 바깥, 아래로만 떨어지는 얕은 그림자**다.
그림이 없을 때는 `src/apps.ts`에서 `{ glyph, from, to }`로 코드 타일을 쓰고, 나중에 PNG로 바꾼다.

## 1. 생성 요청(Codex CLI 기준)

빈 임시 폴더에서 실행한다. 결과는 1024px RGBA다.

```bash
codex exec --skip-git-repo-check --sandbox workspace-write -C <빈 폴더> \
  "Use your image generation tool exactly once to create a square 1024x1024 app icon, then save the generated PNG into the current directory as <이름>.png. Icon description: <아래 템플릿>. No text. After saving, reply with ONLY the absolute path of the saved file."
```

### 앱 아이콘 템플릿

```text
Use case: app icon. Asset type: a production raster macOS-style app icon for a desktop-metaphor web app with Apple-like glassmorphism.
Create exactly ONE square app icon, viewed straight on, crisp, no perspective, no surrounding scene, no lettering, no watermark.
A centered squircle tile (superellipse, n≈5) occupies about 90 percent of the canvas; everything outside the tile is TRANSPARENT (real alpha channel).
Soft top-to-bottom gradient on the tile, a subtle inner top highlight, gentle depth on the symbol; no heavy bevels, no outer glow, no cast shadow outside the tile.
It must read clearly at 48 px and at 20 px. The symbol occupies about 60 percent of the tile, with generous negative space and no tiny detail.
Subject: <상징 하나. 예: "a white sheet of paper with a small tree outline of folders and a yellow pencil", 타일 색 예: "mint to teal (#5ee0d0 to #0d9488)">.
```

타일 없는 모양(예: 폴더)이 필요하면 `TRANSPARENT background (real alpha channel), no tile`을 명시한다.

### 목록용 작은 아이콘(28px) 템플릿

```text
Use case: logo-brand. Asset type: a production raster icon for a macOS-inspired list. Create exactly ONE square icon, flat and crisp, no perspective, no lettering.
It will be displayed at 28 by 28 CSS pixels, so use a single bold, instantly legible symbol with generous negative space.
A centered rounded-square tile occupies 92 percent of the canvas, corner radius about 24 percent, completely transparent outside the tile.
The symbol occupies about 62 percent of the tile. It must work in both light and dark glass UI. Subject: <상징과 타일 색>. No text.
```

## 2. 후처리

```bash
python tools/icon-postprocess.py <생성>.png public/icons/<이름>.png          # 타일형: 11–245px
python tools/icon-postprocess.py <생성>.png public/icons/<이름>.png --shape  # 타일 없는 모양: 가로 14–242px
```

스크립트가 하는 일(그대로 지켜야 가장자리가 깨끗하다):

1. 알파 200 넘는 부분만 모양으로 삼고 4px 안쪽으로 깎는다 — 생성 이미지의 번짐·잡티·어두운 테두리 제거.
2. 모양 바깥 색을 안쪽 이웃 색으로 번져 채운 뒤 `putalpha`로 합친다. **`paste(rgb, mask=alpha)`로 투명 캔버스에 붙이면 반투명 가장자리가 검정과 섞여 밝은 바탕에서 회색 외곽선이 생긴다.**
3. premultiplied(`RGBa`)로 줄인다.
4. 그림자는 아래로만: 6px 아래 · 흐림 3 · 26%.
5. `*.preview-light.png`·`*.preview-dark.png`를 확대해서 가장자리를 확인하고 지운다.

## 3. 바꿀 때

브라우저가 아이콘을 캐시하므로 그림을 바꾸면 주소에 판 번호를 붙인다: `{ src: "/icons/notes.png?v=2" }`.

## 4. Relay에서 실제로 쓴 프로바이더 아이콘 프롬프트(예시)

```text
… Subject: the recognizable OpenAI six-loop interlocking geometric knot, in warm white, centered on a deep muted emerald/teal tile (#173d37 to #24594d). …
… Subject: a bold Claude-inspired warm apricot radial sunburst/asterisk, about twelve broad slightly organic rays, centered on a deep cocoa tile (#39291f to #4c3526). …
… Subject: a recognizable Grok/xAI-inspired minimal white orbital glyph, an open circular ring crossed by one strong diagonal rising slash, centered on a charcoal-black tile (#17191d to #2a2e34). …
… Subject: a recognizable Cursor-inspired minimal isometric cube glyph … centered on a near-black graphite tile (#141416 to #2a2a2f). …
```

(앞뒤 공통 문장은 위 「목록용 작은 아이콘」 템플릿과 같다.)
