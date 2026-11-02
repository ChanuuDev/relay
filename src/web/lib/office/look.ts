/** 세션마다 정해지는 캐릭터 겉모습. 같은 세션은 언제 열어도 같은 모습이다. */
export type Region = "hair" | "shirt" | "pants" | "skin";
export const REGIONS: readonly Region[] = ["hair", "shirt", "pants", "skin"];
/** 바꿀 색의 목표. h는 0–360, s·l은 0–1. contrast는 원래 명암 폭을 얼마나 남길지다. */
export interface Tone { h: number; s: number; l: number; contrast?: number }
/** 부위마다 바꿀 색과 몸체(머리 모양) 번호 */
export type Look = Record<Region, Tone> & { body: number };

export const HAIR: readonly Tone[] = [
  { h: 25, s: 0.35, l: 0.16, contrast: 0.55 }, // 검정에 가까운 짙은 갈색
  { h: 24, s: 0.5, l: 0.3, contrast: 0.8 }, // 갈색
  { h: 30, s: 0.55, l: 0.45, contrast: 0.85 }, // 밝은 갈색
  { h: 44, s: 0.75, l: 0.62, contrast: 0.8 }, // 금발
  { h: 12, s: 0.7, l: 0.42, contrast: 0.85 }, // 적갈색
  { h: 220, s: 0.12, l: 0.72, contrast: 0.7 }, // 은발
  { h: 215, s: 0.65, l: 0.5, contrast: 0.85 }, // 파랑
  { h: 330, s: 0.65, l: 0.62, contrast: 0.85 }, // 분홍
  { h: 160, s: 0.5, l: 0.42, contrast: 0.85 }, // 청록
  { h: 270, s: 0.55, l: 0.5, contrast: 0.85 }, // 보라
];
export const SHIRT: readonly Tone[] = [
  { h: 0, s: 0, l: 0.88, contrast: 0.7 }, // 흰 셔츠
  { h: 210, s: 0.55, l: 0.6 }, // 하늘
  { h: 145, s: 0.45, l: 0.5 }, // 초록
  { h: 4, s: 0.65, l: 0.55 }, // 빨강
  { h: 42, s: 0.8, l: 0.58 }, // 겨자
  { h: 275, s: 0.45, l: 0.55 }, // 보라
  { h: 0, s: 0, l: 0.3, contrast: 0.8 }, // 검정
  { h: 22, s: 0.7, l: 0.55 }, // 주황
  { h: 335, s: 0.55, l: 0.66 }, // 분홍
  { h: 190, s: 0.6, l: 0.5 }, // 청록
  { h: 220, s: 0.12, l: 0.55 }, // 회색
  { h: 95, s: 0.35, l: 0.48 }, // 올리브
];
export const PANTS: readonly Tone[] = [
  { h: 225, s: 0.45, l: 0.28 }, // 남색
  { h: 220, s: 0.08, l: 0.2 }, // 검정
  { h: 215, s: 0.1, l: 0.4 }, // 회색
  { h: 35, s: 0.35, l: 0.45 }, // 베이지
  { h: 25, s: 0.35, l: 0.28 }, // 갈색
  { h: 210, s: 0.4, l: 0.42 }, // 청바지
];
export const SKIN: readonly Tone[] = [
  { h: 27, s: 0.8, l: 0.83 },
  { h: 26, s: 0.62, l: 0.74 },
  { h: 24, s: 0.48, l: 0.62 },
  { h: 22, s: 0.4, l: 0.48 },
  { h: 20, s: 0.36, l: 0.36 },
];

/** FNV-1a 32비트. 세션 ID를 고르게 흩는다. */
export function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/** 시드 하나로 이어지는 의사 난수(mulberry32). */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)]!;

export function lookFor(id: string, bodies = 1): Look {
  const random = seeded(hash(id));
  return { hair: pick(HAIR, random), shirt: pick(SHIRT, random), pants: pick(PANTS, random), skin: pick(SKIN, random),
    body: Math.floor(random() * bodies) };
}

/** 같은 색끼리 바꾼 그림을 함께 쓰도록 색을 짧은 키로 줄인다. 몸체는 같은 그림의 다른 줄이라 키에 넣지 않는다. */
export const lookKey = (look: Record<Region, Tone>) => REGIONS.map((region) => {
  const tone = look[region];
  return `${tone.h},${tone.s},${tone.l},${tone.contrast ?? 1}`;
}).join("|");

type HSL = [number, number, number];

export function rgbToHsl(r: number, g: number, b: number): HSL {
  const red = r / 255, green = g / 255, blue = b / 255;
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === red ? (green - blue) / d + (green < blue ? 6 : 0) : max === green ? (blue - red) / d + 2 : (red - green) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(channel(hue + 1 / 3) * 255), Math.round(channel(hue) * 255), Math.round(channel(hue - 1 / 3) * 255)];
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** 바탕 그림의 한 색을 목표 색으로 옮긴다. base는 그 부위의 가운데 색(HSL)이며, 명암 차이는 그대로 따라온다. */
export function shift(rgb: [number, number, number], base: HSL, tone: Tone): [number, number, number] {
  const [h, s, l] = rgbToHsl(...rgb);
  const contrast = tone.contrast ?? 1;
  const saturation = base[1] > 0 ? clamp(s * (tone.s / base[1])) : tone.s;
  return hslToRgb(tone.h + (h - base[0]), Math.min(saturation, 1), clamp(tone.l + (l - base[2]) * contrast));
}

/** 그림 픽셀(RGBA)에서 부위 색표에 있는 색만 목표 색으로 바꾼다. palette의 키는 0xRRGGBB다. */
export function recolor(pixels: Uint8ClampedArray, palette: ReadonlyMap<number, Region>, bases: Record<Region, HSL>, look: Record<Region, Tone>) {
  const cache = new Map<number, number>();
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const key = (pixels[index]! << 16) | (pixels[index + 1]! << 8) | pixels[index + 2]!;
    let next = cache.get(key);
    if (next === undefined) {
      const region = palette.get(key);
      if (region) {
        const [r, g, b] = shift([pixels[index]!, pixels[index + 1]!, pixels[index + 2]!], bases[region], look[region]);
        next = (r << 16) | (g << 8) | b;
      } else next = key;
      cache.set(key, next);
    }
    if (next === key) continue;
    pixels[index] = next >> 16; pixels[index + 1] = (next >> 8) & 255; pixels[index + 2] = next & 255;
  }
  return pixels;
}
