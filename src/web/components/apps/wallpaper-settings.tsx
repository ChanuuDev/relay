import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Images, Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Button } from "../ui/button";
import { useUI } from "../../lib/store";
import { COLORS, MAX_CUSTOM_IMAGES, PRESETS, deleteCustomImage, imageLabel, prepareImage, presetUrl, sameChoice, storeCustomImage, type WallpaperChoice } from "../../lib/wallpaper";

const PAGE_SIZE = 3;

function PhotoCarousel({ items, selectedIndex }: { items: ReactNode[]; selectedIndex: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [page, setPage] = useState(0);
  const count = Math.ceil(items.length / PAGE_SIZE);
  const active = Math.min(page, count - 1);

  function goTo(next: number) {
    current.current = Math.max(0, Math.min(next, count - 1));
    setPage(current.current);
  }
  useEffect(() => {
    if (selectedIndex >= 0) goTo(Math.floor(selectedIndex / PAGE_SIZE));
  }, [selectedIndex]);
  useEffect(() => {
    if (current.current >= count) goTo(count - 1);
  }, [count]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let lastWheel = -Infinity;
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 4) return;
      event.preventDefault();
      if (event.timeStamp - lastWheel < 250) return;
      lastWheel = event.timeStamp;
      goTo(current.current + Math.sign(event.deltaX));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [count]);

  return <div className="wallpaper-carousel" role="region" aria-label="바탕화면 사진" aria-roledescription="캐러셀" tabIndex={0}
    onKeyDown={(event) => {
      swiped.current = false;
      if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      goTo(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : active + (event.key === "ArrowRight" ? 1 : -1));
      event.currentTarget.focus();
    }}>
    <div className="wallpaper-viewport" ref={viewport} onDragStart={(event) => event.preventDefault()}
      onPointerDownCapture={(event) => { swiped.current = false; gesture.current = { x: event.clientX, y: event.clientY }; }}
      onPointerCancel={() => { gesture.current = null; }}
      onPointerUpCapture={(event) => {
        const start = gesture.current; gesture.current = null;
        if (!start) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
        swiped.current = true;
        goTo(active + (dx < 0 ? 1 : -1));
      }} onClickCapture={(event) => {
        if (!swiped.current) return;
        swiped.current = false; event.preventDefault(); event.stopPropagation();
      }}>
      <div className="wallpaper-track" style={{ transform: `translateX(-${active * 100}%)` }}>
      {Array.from({ length: count }, (_, index) => <div key={index} className="wallpaper-page" role="group" aria-roledescription="슬라이드"
        aria-label={`${index + 1} / ${count}`} inert={index !== active}>
        {items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE)}
      </div>)}
      </div>
    </div>
    <nav className="wallpaper-pager" aria-label="사진 페이지">
      <Button type="button" size="icon-sm" variant="ghost" aria-label="이전 사진 페이지" disabled={active === 0} onClick={() => goTo(active - 1)}><ChevronLeft /></Button>
      <div className="wallpaper-page-status">
        <div className="wallpaper-page-dots">{Array.from({ length: count }, (_, index) => <button key={index} type="button"
          aria-label={`사진 ${index + 1}페이지`} aria-current={index === active ? "page" : undefined} onClick={() => goTo(index)}><span /></button>)}</div>
        <span className="wallpaper-page-count" aria-live="polite" aria-atomic="true">{active + 1} / {count}</span>
      </div>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="다음 사진 페이지" disabled={active === count - 1} onClick={() => goTo(active + 1)}><ChevronRight /></Button>
    </nav>
  </div>;
}

export function WallpaperSettings() {
  const wallpaper = useUI((state) => state.wallpaper);
  const setWallpaper = useUI((state) => state.setWallpaper);
  const images = useUI((state) => state.customImages);
  const addCustomImage = useUI((state) => state.addCustomImage);
  const removeCustomImage = useUI((state) => state.removeCustomImage);
  const fileInput = useRef<HTMLInputElement>(null);
  const galleryTrigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photos: { choice: WallpaperChoice; label: string; thumb: ReactNode; remove?: () => void }[] = [
    { choice: { kind: "dynamic" }, label: "기본", thumb: <><img src="/wallpaper-light.jpg" alt="" data-layer="light" /><img src="/wallpaper-dark.jpg" alt="" data-layer="dark" /></> },
    ...PRESETS.map((preset) => ({ choice: { kind: "preset" as const, id: preset.id }, label: preset.label, thumb: <img src={presetUrl(preset.id)} alt="" loading="lazy" /> })),
    ...images.map((image) => ({ choice: { kind: "custom" as const, id: image.id }, label: image.name, thumb: <img src={image.url} alt="" />, remove: () => void remove(image.id) })),
  ];
  const tile = ({ choice, label, thumb, remove }: (typeof photos)[number]) =>
    <div key={`${choice.kind}-${"id" in choice ? choice.id : ""}`} className="wallpaper-tile">
      <button type="button" role="radio" aria-checked={sameChoice(wallpaper, choice)} className="wallpaper-choice" onClick={() => setWallpaper(choice)}>
        <span className="wallpaper-thumb">{thumb}</span><span className="wallpaper-label">{label}</span>
      </button>
      {remove && <button type="button" className="wallpaper-remove" aria-label={`${label} 지우기`} onClick={remove}><X aria-hidden="true" /></button>}
    </div>;
  const addTile = <button key="add" type="button" className="wallpaper-choice wallpaper-tile-add" disabled={busy} data-busy={busy ? "" : undefined} onClick={() => fileInput.current?.click()}>
    <span className="wallpaper-thumb"><Plus aria-hidden="true" /></span><span className="wallpaper-label">{busy ? "저장 중…" : "사진 추가…"}</span>
  </button>;

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true); setError(null);
    const failures: string[] = [];
    try {
      for (const file of files) {
        if (useUI.getState().customImages.length >= MAX_CUSTOM_IMAGES) { failures.push(`내 사진은 ${MAX_CUSTOM_IMAGES}장까지 둘 수 있습니다.`); break; }
        try {
          const blob = await prepareImage(file);
          const saved = await storeCustomImage(blob, imageLabel(file));
          addCustomImage({ id: saved.id, name: saved.name, url: URL.createObjectURL(blob) });
          setWallpaper({ kind: "custom", id: saved.id });
        } catch (failure) { failures.push(`${file.name}: ${failure instanceof Error ? failure.message : "저장할 수 없습니다."}`); }
      }
    } finally { setBusy(false); }
    if (failures.length) setError(failures.join(" "));
  }
  async function remove(id: string) {
    await deleteCustomImage(id);
    removeCustomImage(id);
    const current = useUI.getState().wallpaper;
    if (current.kind === "custom" && current.id === id) setWallpaper({ kind: "dynamic" });
  }

  return <Dialog.Root>
    <section className="settings-group" id="wallpaper-settings">
      <header className="wallpaper-heading"><h3>바탕화면</h3>
        <Dialog.Trigger asChild><Button ref={galleryTrigger} type="button" size="sm" variant="ghost"><Images aria-hidden="true" />전체보기</Button></Dialog.Trigger>
      </header>
      <input ref={fileInput} id="wallpaper-file" className="wallpaper-file" type="file" accept="image/*" multiple onChange={pick} disabled={busy} tabIndex={-1} aria-label="바탕화면 사진 추가" />
      <div className="wallpaper-picker" role="radiogroup" aria-label="바탕화면">
        <PhotoCarousel items={[...photos.map(tile), addTile]} selectedIndex={photos.findIndex((photo) => sameChoice(wallpaper, photo.choice))} />
        <div className="wallpaper-colors">{COLORS.map((color) => tile({ choice: { kind: "color", id: color.id }, label: color.label, thumb: <span className="wallpaper-swatch" data-color={color.id} /> }))}</div>
      </div>
      {error && <p className="settings-note settings-error" role="alert">{error}</p>}
      <p className="settings-note">사진은 좌우로 넘겨 고르고 전체보기에서 한 번에 볼 수 있습니다. 내 사진은 {MAX_CUSTOM_IMAGES}장까지 이 브라우저에만 저장됩니다. 견본 모서리의 ×로 지웁니다.</p>
    </section>
    <Dialog.Portal>
      <Dialog.Overlay className="wallpaper-dialog-overlay" />
      <Dialog.Content className="wallpaper-dialog" onCloseAutoFocus={(event) => {
        event.preventDefault();
        galleryTrigger.current?.focus({ preventScroll: true });
      }} onOpenAutoFocus={(event) => {
        event.preventDefault();
        const dialog = document.querySelector(".wallpaper-dialog");
        const selected = (dialog?.querySelector('[aria-checked="true"]') ?? dialog?.querySelector(".wallpaper-choice")) as HTMLElement | null;
        selected?.scrollIntoView({ block: "nearest" });
        selected?.focus({ preventScroll: true });
      }}>
        <header className="wallpaper-dialog-header">
          <div><Dialog.Title>바탕화면 사진 전체보기</Dialog.Title><Dialog.Description>총 {photos.length}개 · 사진을 고르면 바로 적용됩니다.</Dialog.Description></div>
          <Dialog.Close asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="전체보기 닫기"><X /></Button></Dialog.Close>
        </header>
        <div className="wallpaper-gallery" role="radiogroup" aria-label="전체 바탕화면 사진">{photos.map(tile)}{addTile}</div>
        {error && <p className="settings-note settings-error" role="alert">{error}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
