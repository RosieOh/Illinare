import { looksLikeApproval, pickNearest, type RectLike } from '@/lib/client/gesture/snap';

/** 제스처가 실제 화면을 건드리는 부분. */
const ACTIONABLE = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[role="button"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const SNAP_RADIUS = 44;

function isUsable(el: HTMLElement): boolean {
  if (el.closest('[inert]') || el.closest('[data-gesture-ignore]')) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.pointerEvents !== 'none' && style.display !== 'none';
}

/** 다른 요소에 가려져 있으면 누를 수 없으므로 제외한다. */
function isOnTop(el: HTMLElement, x: number, y: number): boolean {
  const hit = document.elementFromPoint(x, y);
  return !!hit && (el === hit || el.contains(hit));
}

export interface ActionTarget {
  el: HTMLElement;
  x: number;
  y: number;
}

/** 열려 있는 맨 위 시트. 시트가 열려 있으면 그 안의 것만 누를 수 있다. */
function topDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs.length ? dialogs[dialogs.length - 1] : null;
}

export function findActionTarget(x: number, y: number): ActionTarget | null {
  const dialog = topDialog();
  const scope: ParentNode = dialog ?? document;

  const hit = document.elementFromPoint(x, y);
  const direct = hit?.closest<HTMLElement>(ACTIONABLE);
  if (direct && (!dialog || dialog.contains(direct)) && isUsable(direct)) return { el: direct, x, y };

  const items: { el: HTMLElement; rect: RectLike }[] = [];
  scope.querySelectorAll<HTMLElement>(ACTIONABLE).forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.right < x - SNAP_RADIUS || rect.left > x + SNAP_RADIUS || rect.bottom < y - SNAP_RADIUS || rect.top > y + SNAP_RADIUS) return;
    if (isUsable(el)) items.push({ el, rect });
  });
  const nearest = pickNearest(items, x, y, SNAP_RADIUS);
  if (!nearest) return null;
  const cx = (nearest.rect.left + nearest.rect.right) / 2;
  const cy = (nearest.rect.top + nearest.rect.bottom) / 2;
  return isOnTop(nearest.el, cx, cy) ? { el: nearest.el, x: cx, y: cy } : null;
}

/** 제스처로 누르면 안 되는 대상인가. 승인 UI 안의 것은 거부 버튼까지 포함해 전부 막는다. */
export function isApprovalElement(el: HTMLElement): boolean {
  if (el.closest('[data-approval-ui]')) return true;
  return looksLikeApproval(el.getAttribute('aria-label')) || looksLikeApproval(el.textContent);
}

/** 실제 입력과 같은 순서로 이벤트를 보낸다. click만 보내면 포커스와 pointer 핸들러가 동작하지 않는다. */
export function pressElement({ el, x, y }: ActionTarget) {
  const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
  const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0, buttons: 1 }));
  el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0, buttons: 0 }));
  // 입력창은 포커스만 주면 된다. select는 스크립트로 열 수 없다.
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
  el.dispatchEvent(new MouseEvent('click', { ...base, button: 0, buttons: 0 }));
}

export function hasOpenDialog(): boolean {
  return topDialog() !== null;
}

/** 시트의 Esc 처리를 그대로 탄다. 닫을 수 없는 시트는 닫히지 않는다. */
export function closeTopDialog() {
  if (!hasOpenDialog()) return;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}
