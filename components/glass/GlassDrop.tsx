'use client';

import { useLayoutEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type AnimationPlaybackControls, type MotionValue } from 'framer-motion';
import { spring } from './motion';

export interface GlassDropProps {
  /** 방울이 덮을 요소. 부모(position이 있는 요소) 안에 있어야 한다 */
  target: HTMLElement | null;
  className?: string;
}

interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 시트가 열리며 크기가 변하는 중에도 틀어지지 않도록 변형의 영향을 받지 않는 값으로 잰다. */
function edgesWithin(el: HTMLElement, ancestor: HTMLElement): Edges | null {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (!node) return null;
  return { left, top, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

/**
 * 선택 표시. 가는 쪽 가장자리는 빠른 스프링, 떠나는 쪽은 느린 스프링을 타서 옮겨 가는 동안 늘어났다가 모인다.
 * 네 변을 따로 움직이므로 세로 레일과 가로 세그먼트에 같이 쓴다.
 */
export function GlassDrop({ target, className }: GlassDropProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const top = useMotionValue(0);
  const bottom = useMotionValue(0);
  const width = useTransform<number, number>([left, right], ([l, r]) => Math.max(0, r - l));
  const height = useTransform<number, number>([top, bottom], ([t, b]) => Math.max(0, b - t));
  const placedOn = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!target || !parent) return;
    const running: AnimationPlaybackControls[] = [];
    const stop = () => running.splice(0).forEach((control) => control.stop());

    const jump = (edges: Edges) => {
      stop();
      left.set(edges.left);
      right.set(edges.right);
      top.set(edges.top);
      bottom.set(edges.bottom);
    };
    const travel = (edges: Edges) => {
      stop();
      const go = (value: MotionValue<number>, to: number, leading: boolean) =>
        running.push(animate(value, to, leading ? spring.snappy : spring.drop));
      const rightward = edges.left > left.get();
      const downward = edges.top > top.get();
      go(left, edges.left, !rightward);
      go(right, edges.right, rightward);
      go(top, edges.top, !downward);
      go(bottom, edges.bottom, downward);
    };

    const edges = edgesWithin(target, parent);
    if (edges) {
      if (placedOn.current && placedOn.current !== target && !reduce) travel(edges);
      else jump(edges);
    }
    placedOn.current = target;

    // 창 크기나 글자 크기가 바뀌면 애니메이션 없이 맞춘다. 관찰을 시작할 때의 첫 호출은 값이 그대로라 무시된다.
    let last = edges;
    const observer = new ResizeObserver(() => {
      const next = edgesWithin(target, parent);
      if (!next) return;
      if (last && next.left === last.left && next.right === last.right && next.top === last.top && next.bottom === last.bottom) return;
      last = next;
      jump(next);
    });
    observer.observe(target);
    observer.observe(parent);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [target, reduce, left, right, top, bottom]);

  return <motion.span ref={ref} className={`glass-drop ${className ?? ''}`} style={{ x: left, y: top, width, height }} aria-hidden="true" />;
}
