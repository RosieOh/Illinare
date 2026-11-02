import { session, shell } from 'electron';

/** 앱 자신의 출처에만 허용하는 권한. 그 외의 요청은 모두 거부한다. */
const ALLOWED_PERMISSIONS = new Set([
  'media', // 제스처용 카메라, 음성용 마이크. 미디어 종류는 아래에서 다시 확인한다.
  'fullscreen', // 발표 전체 화면
  'clipboard-sanitized-write', // 복사 버튼. 클립보드 읽기는 허용하지 않는다.
  'notifications', // 집중 타이머 완료 알림
]);

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url);
  } catch {
    /* 잘못된 주소는 무시한다 */
  }
}

export function hardenSession(appOrigin) {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (originOf(details.requestingUrl ?? contents.getURL()) !== appOrigin) return callback(false);
    if (!ALLOWED_PERMISSIONS.has(permission)) return callback(false);
    if (permission === 'media') {
      const types = details.mediaTypes ?? [];
      return callback(types.length > 0 && types.every((t) => t === 'video' || t === 'audio'));
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && originOf(requestingOrigin) === appOrigin;
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.setSpellCheckerEnabled(false);
}

/** 모든 웹 콘텐츠에 적용한다. 앱 밖으로 나가는 탐색은 막고, 외부 링크는 기본 브라우저로 넘긴다. */
export function hardenContents(contents, getOrigin) {
  contents.on('will-navigate', (event, url) => {
    if (originOf(url) === getOrigin()) return;
    event.preventDefault();
    openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (originOf(url) !== getOrigin()) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
