# 프로바이더 아이콘

OpenAI(Codex), Anthropic(Claude Code), xAI(Grok)의 목록 아이콘을 내장 ImageGen 도구로 각각 생성했습니다. 기존 28px 아바타 영역에서 보이는 매듭·별·궤도 문양이며, 공식 배포 로고 파일을 복사한 자산은 아닙니다.

둥근 타일 바깥의 투명도를 보존한 PNG를 `assets.ts`에서 실행 파일에 포함합니다.

## 생성 프롬프트

### openai

```text
Use case: logo-brand. Asset type: a production raster provider icon for Relay, a macOS-inspired local developer session viewer. Create exactly ONE square app icon, viewed straight on, flat and crisp, with no perspective, no surrounding scene, no lettering, no watermark, no cast shadow outside the tile. It will be displayed at 28 by 28 CSS pixels, so use a single bold, instantly legible symbol with generous negative space and no fine texture or tiny detail. A centered rounded-square tile occupies 92 percent of the square canvas, corner radius about 24 percent, completely transparent outside the rounded tile. Subtle smooth surface shading is fine, but do not add bevels or decorative objects. The symbol occupies about 62 percent of the tile. All visible edges sharp with careful antialiasing. It must work in both light and dark glass UI. Subject: the recognizable OpenAI six-loop interlocking geometric knot, in warm white, centered on a deep muted emerald/teal tile (#173d37 to #24594d). Carefully preserve the symmetrical interwoven knot silhouette, broad ribbon strokes, clean open spaces. No terminal prompt symbol. No text.
```

### anthropic

```text
Use case: logo-brand. Asset type: a production raster provider icon for Relay, a macOS-inspired local developer session viewer. Create exactly ONE square app icon, viewed straight on, flat and crisp, with no perspective, no surrounding scene, no lettering, no watermark, no cast shadow outside the tile. It will be displayed at 28 by 28 CSS pixels, so use a single bold, instantly legible symbol with generous negative space and no fine texture or tiny detail. A centered rounded-square tile occupies 92 percent of the square canvas, corner radius about 24 percent, completely transparent outside the rounded tile. Subtle smooth surface shading is fine, but do not add bevels or decorative objects. The symbol occupies about 62 percent of the tile. All visible edges sharp with careful antialiasing. It must work in both light and dark glass UI. Subject: a bold Claude-inspired warm apricot radial sunburst/asterisk, about twelve broad slightly organic rays, centered on a deep cocoa tile (#39291f to #4c3526). The shape must read as a distinctive orange sunburst at 28px, not as a generic gear or flower. Palette of soft terracotta and apricot (#eea072), warm and restrained. No face. No text.
```

### xai

```text
Use case: logo-brand. Asset type: a production raster provider icon for Relay, a macOS-inspired local developer session viewer. Create exactly ONE square app icon, viewed straight on, flat and crisp, with no perspective, no surrounding scene, no lettering, no watermark, no cast shadow outside the tile. It will be displayed at 28 by 28 CSS pixels, so use a single bold, instantly legible symbol with generous negative space and no fine texture or tiny detail. A centered rounded-square tile occupies 92 percent of the square canvas, corner radius about 24 percent, completely transparent outside the rounded tile. Subtle smooth surface shading is fine, but do not add bevels or decorative objects. The symbol occupies about 62 percent of the tile. All visible edges sharp with careful antialiasing. It must work in both light and dark glass UI. Subject: a recognizable Grok/xAI-inspired minimal white orbital glyph, an open circular ring crossed by one strong diagonal rising slash from lower left to upper right, centered on a charcoal-black tile (#17191d to #2a2e34). The diagonal extends just beyond the open ring to create a bold dynamic mark; use a clean generous ring stroke. Monochrome, simple, precise. No planet shading or stars. No text.
```
