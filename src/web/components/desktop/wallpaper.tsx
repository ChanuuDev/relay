const LAYERS = ["dark", "light"] as const;

/** 바닥은 토큰 그라디언트, 위는 테마별 사진. 두 장을 겹쳐 두고 불투명도로 전환한다. */
export function Wallpaper({ dark }: { dark: boolean }) {
  return <div className="wallpaper" aria-hidden="true">
    {LAYERS.map((layer) => <img key={layer} className="wallpaper-image" src={`/wallpaper-${layer}.jpg`} alt=""
      data-layer={layer} data-active={(layer === "dark") === dark ? "" : undefined}
      draggable={false} decoding="async" fetchPriority="high" />)}
  </div>;
}
