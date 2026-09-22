import { Component, createRef, type ReactNode, type RefObject } from "react";
import { captureClone, captureRows, dropClones, enter, fadeClone, flipRows, type FlipSnapshot } from "../lib/motion";

type FlipListProps = { items: unknown; listKey?: string; className?: string; children: ReactNode };

/**
 * 목록 재정렬을 FLIP으로 잇는다. 함수 컴포넌트에는 커밋 직전 훅이 없어 이 경우만 클래스를 쓴다(§1).
 * `items` 참조가 바뀔 때만 캡처하므로, 내용이 같은 폴링에서는 아무것도 움직이지 않는다.
 */
export class FlipList extends Component<FlipListProps> {
  private root = createRef<HTMLOListElement>();
  private snapshot: FlipSnapshot | null = null;

  getSnapshotBeforeUpdate(prev: FlipListProps) {
    this.snapshot = prev.listKey === this.props.listKey && prev.items !== this.props.items
      ? captureRows(this.root.current) : null;
    return null;
  }
  componentDidUpdate() {
    const snapshot = this.snapshot;
    this.snapshot = null;
    if (snapshot) flipRows(snapshot, this.root.current);
  }
  render() {
    return <ol ref={this.root} className={this.props.className}>{this.props.children}</ol>;
  }
}

type CrossfadeProps = {
  swapKey: string;
  container: RefObject<HTMLElement | null>;
  select: string;
  from?: { x?: number; y?: number };
  onEntered?: (element: HTMLElement) => void;
  children: ReactNode;
};

/**
 * `key` 교체로 리마운트되는 영역을 크로스페이드한다(§3-C1). 교체 직전 DOM을 클론해 같은 자리에 덮고
 * 페이드아웃하며, 새 콘텐츠는 페이드인한다. React 상태는 건드리지 않는다.
 */
export class Crossfade extends Component<CrossfadeProps> {
  private clone: HTMLElement | null = null;
  private swapped = false;

  componentDidMount() { this.play(); }
  getSnapshotBeforeUpdate(prev: CrossfadeProps) {
    this.swapped = prev.swapKey !== this.props.swapKey;
    this.clone = this.swapped ? captureClone(this.props.container.current, this.props.select) : null;
    return null;
  }
  componentDidUpdate() {
    if (!this.swapped) return;
    this.swapped = false;
    this.play();
  }
  componentWillUnmount() { dropClones(this.props.container.current); }

  private play() {
    fadeClone(this.clone);
    this.clone = null;
    const next = this.props.container.current?.querySelector<HTMLElement>(this.props.select) ?? null;
    if (!next) return;
    const { x = 12, y = 0 } = this.props.from ?? {};
    enter(next, { x, y });
    this.props.onEntered?.(next);
  }
  render() { return this.props.children; }
}
