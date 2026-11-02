/**
 * 브라우저로 넘길 URL을 정규화한다. OS에는 입력 그대로가 아니라 파싱한 결과만 전달한다.
 * http와 https만 허용하고, `https://naver.com@evil.example`처럼 주소를 속이는 사용자 정보는 거부한다.
 */
export function webUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL 형식이 올바르지 않아요');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http와 https 주소만 열 수 있어요');
  if (url.username || url.password) throw new Error('사용자 이름이나 비밀번호가 들어간 주소는 열 수 없어요');
  return url.href;
}
