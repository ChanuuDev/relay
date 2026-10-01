import { useEffect, useRef, useState } from "react";
import { useUI } from "../../lib/store";
import { presetUrl } from "../../lib/wallpaper";

const LAYERS = ["dark", "light"] as const;
/** CSS의 `.wallpaper-image` 전환(300ms)보다 조금 길게 두고, 그 뒤에 가려지거나 걷힌 사진을 치운다. */
const FADE_MS = 360;

/** 고른 사진 한 장의 생애: 로드 중(투명) → 보임 → 걷힘(투명으로 전환 뒤 제거). */
type Layer = { key: number; src: string; state: "loading" | "shown" | "leaving" };

/** 보이는 사진은 맨 위 한 장만 남기고 걷히는 사진은 치운다. 로드 중인 사진은 건드리지 않는다. */
const prune = (layers: Layer[]) => {
  const top = layers.findLast((layer) => layer.state === "shown");
  return layers.filter((layer) => layer.state === "loading" || layer === top);
};

/** 바닥은 토큰 그라디언트(색상 프리셋이면 그 색), 그 위에 테마별 기본 사진 2장, 맨 위에 고른 사진.
 *  기본 사진은 불투명도로 테마를 오가고, 고른 사진은 로드가 끝난 뒤 크로스페이드한다. */
export function Wallpaper({ dark }: { dark: boolean }) {
  const choice = useUI((state) => state.wallpaper);
  const custom = useUI((state) => state.customImage);
  const photo = choice.kind === "preset" ? presetUrl(choice.id) : choice.kind === "custom" ? custom : null;
  // 내 사진을 골랐지만 아직(또는 더는) 없으면 기본 사진으로 돌아간다.
  const dynamic = choice.kind === "dynamic" || (choice.kind === "custom" && !custom);
  return <div className="wallpaper" aria-hidden="true" data-color={choice.kind === "color" ? choice.id : undefined}>
    {LAYERS.map((layer) => <img key={layer} className="wallpaper-image" src={`/wallpaper-${layer}.jpg`} alt=""
      data-layer={layer} data-active={dynamic && (layer === "dark") === dark ? "" : undefined}
      draggable={false} decoding="async" fetchPriority={dynamic ? "high" : "low"} />)}
    <Photo src={photo} />
  </div>;
}

function Photo({ src }: { src: string | null }) {
  const [layers, setLayers] = useState<Layer[]>(() => (src ? [{ key: 0, src, state: "loading" }] : []));
  const latest = useRef(layers);
  latest.current = layers;
  const seq = useRef(1);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLayers(prune), FADE_MS);
  };
  useEffect(() => {
    const top = latest.current.at(-1);
    if ((top && top.state !== "leaving" ? top.src : null) === src) return;
    if (src) { setLayers((current) => [...current, { key: seq.current++, src, state: "loading" }]); return; }
    setLayers((current) => current.map((layer) => (layer.state === "leaving" ? layer : { ...layer, state: "leaving" })));
    settle();
  }, [src]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // 로드가 끝난 사진이 맨 위면 켜고, 그새 다른 사진이 올라왔거나 실패했으면 걷는다.
  // ref 콜백은 렌더마다 불리므로 로드 중인 사진에만 반응해야 갱신이 돌지 않는다.
  const done = (key: number, ok: boolean) => {
    const current = latest.current;
    const me = current.find((layer) => layer.key === key);
    if (!me || me.state !== "loading") return;
    const state = ok && current.at(-1) === me ? "shown" : "leaving";
    setLayers((all) => all.map((layer) => (layer.key === key ? { ...layer, state } : layer)));
    settle();
  };
  return <>{layers.map((layer) => <img key={layer.key} className="wallpaper-image wallpaper-photo" src={layer.src} alt=""
    data-active={layer.state === "shown" ? "" : undefined} draggable={false} decoding="async" fetchPriority="high"
    onLoad={() => done(layer.key, true)} onError={() => done(layer.key, false)}
    ref={(image) => { if (image?.complete && image.naturalWidth > 0) done(layer.key, true); }} />)}</>;
}
