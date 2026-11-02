export interface LinkCheck {
  /** 열 수 있는 주소. 허용하지 않는 주소면 null */
  href: string | null;
  /** 표시 글자 뒤에 보여 줄 호스트. 글자가 곧 주소이면 null */
  host: string | null;
  /** 열기 전에 전체 주소를 확인받아야 하는가 */
  needsConfirm: boolean;
}

const BLOCKED: LinkCheck = { href: null, host: null, needsConfirm: false };

function normalized(text: string): string {
  return text.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
}

/**
 * 모델 출력의 링크는 믿을 수 없다. 글자와 실제 주소가 다르거나 주소에 데이터를 실을 수 있으면
 * 한 번의 클릭으로 정보가 밖으로 나갈 수 있으므로 확인을 거친다.
 * - http(s)만 연다. mailto는 본문이나 제목을 미리 채울 수 있으면 막는다.
 */
export function linkCheck(raw: string | undefined, label: string): LinkCheck {
  if (!raw) return BLOCKED;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return BLOCKED;
  }
  if (url.protocol === 'mailto:') {
    return url.search ? BLOCKED : { href: url.href, host: null, needsConfirm: false };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return BLOCKED;

  const labelIsAddress = normalized(label) === normalized(raw);
  const carriesData = Boolean(url.search || url.hash || url.username || url.password);
  return {
    href: url.href,
    host: labelIsAddress ? null : url.hostname,
    needsConfirm: !labelIsAddress || carriesData,
  };
}
