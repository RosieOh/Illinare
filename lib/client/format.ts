import type { ApiKeyStorage } from '@/lib/contracts';

/** 화면 표시용 포맷터. 시간과 비용은 어디서나 같은 모양으로 보여준다. */

/** 키를 실제로 어떻게 보관하는지. 평문으로 물러났을 때 그대로 말하는 것이 목적이다. */
export function keyStorageNote(storage: ApiKeyStorage | undefined): string | null {
  switch (storage) {
    case 'dpapi':
      return 'Windows DPAPI로 암호화해 이 사용자 계정에서만 풀 수 있게 보관해요.';
    case 'keychain':
      return 'macOS 키체인에 보관해요.';
    case 'secret-service':
      return '시스템 키 저장소(Secret Service)에 보관해요.';
    case 'file':
      return 'OS 키 저장소를 쓸 수 없어 앱 폴더의 파일에 암호화하지 않고 보관하고 있어요.';
    case 'unreadable':
      return '저장된 키를 풀지 못했어요. 키 저장소가 잠겨 있으면 풀어 주시고, 그래도 안 되면 키를 다시 등록해 주세요.';
    default:
      return null;
  }
}

/** 경과 시간: 0:32, 12:05, 1:02:10 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 비용: $0.012, $1.24 */
export function formatCost(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** 시계: 14:32 */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 상대 시간: 방금, 5분 전, 3시간 전, 어제, 10월 3일 */
export function formatRelative(at: number, now: number): string {
  const diff = now - at;
  if (diff < 60_000) return '방금';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  if (diff < 2 * 86_400_000) return '어제';
  return new Date(at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}
