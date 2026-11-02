import type { ApprovalPreview } from '@/lib/contracts';

/**
 * 승인 카드에 보여줄 글자 다듬기. 사용자가 보는 것과 실제로 실행되는 것이 같아야 한다.
 * 보이지 않는 문자(폭 없는 문자, 양방향 제어 문자, 태그 문자 등)는 지우지 않고 [U+202E]처럼 드러낸다.
 * 줄바꿈, 탭은 여기 없다. 호출하는 쪽이 용도에 맞게 다룬다.
 */
const INVISIBLE_CLASS =
  '\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F\\u200B-\\u200F\\u2028-\\u202F\\u205F-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0\\uFFF9-\\uFFFB\\u{E0000}-\\u{E0FFF}';
const INVISIBLE_ANY = new RegExp(`[${INVISIBLE_CLASS}]`, 'u');
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE_CLASS}]`, 'gu');

const HIDDEN_FLAG = '숨은 문자 포함';

/** 보이지 않는 문자가 들어 있는가 */
export function hasInvisibleChars(text: string): boolean {
  return INVISIBLE_ANY.test(text);
}

/** 보이지 않는 문자를 [U+XXXX]로 바꿔 눈에 보이게 한다. */
export function escapeInvisible(text: string): string {
  return text.replace(INVISIBLE_ALL, (c) => {
    const code = c.codePointAt(0) ?? 0;
    return `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
  });
}

/** 한 줄 요약용. 줄바꿈이나 긴 공백으로 뒷부분을 화면 밖으로 밀어내지 못하게 한다. */
export function displaySummary(text: string): string {
  const oneLine = escapeInvisible(text)
    .replace(/\r\n?|\n/g, ' ⏎ ')
    .replace(/\t/g, ' ')
    .replace(/ {4,}/g, (run) => ` [공백 ${run.length}개] `);
  return hasInvisibleChars(text) ? `${oneLine} (${HIDDEN_FLAG})` : oneLine;
}

function previewText(text: string): string {
  return escapeInvisible(text).replace(/\r\n?/g, '\n');
}

/** 미리보기용. 줄바꿈은 살리고 보이지 않는 문자만 드러낸다. */
export function displayPreview(preview: ApprovalPreview): ApprovalPreview {
  const next: ApprovalPreview = { ...preview };
  if (preview.path !== undefined) next.path = escapeInvisible(preview.path);
  if (preview.before !== undefined) next.before = previewText(preview.before);
  if (preview.after !== undefined) next.after = previewText(preview.after);
  if (preview.text !== undefined) {
    const body = previewText(preview.text);
    next.text = hasInvisibleChars(preview.text) ? `(${HIDDEN_FLAG}: [U+…]로 표시한 자리를 확인하세요)\n${body}` : body;
  }
  return next;
}

/**
 * 미션 이벤트에 저장하기 전에 본문을 뺀 미리보기.
 * 승인 카드는 실행 중 메모리에서만 본문을 보여주고, 디스크와 내보내기에는 이 형태만 남긴다.
 */
export function redactPreviewForStorage(preview: ApprovalPreview): ApprovalPreview {
  const stored: ApprovalPreview = { kind: 'text', text: '(미리보기 내용은 저장하지 않았어요)' };
  if (preview.path !== undefined) stored.path = preview.path;
  return stored;
}

/** 긴 글을 요약에 넣을 때 앞과 뒤를 모두 보여준다. 위험한 내용은 끝에 숨기 쉽다. */
export function headAndTail(text: string, head = 60, tail = 60): string {
  if (text.length <= head + tail + 5) return text;
  return `${text.slice(0, head)} … ${text.slice(-tail)}`;
}
