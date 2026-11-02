/**
 * 이미지 헤더에서 크기만 읽는다. 전체를 디코딩하지 않는다.
 * 형식을 알아볼 수 없으면 null을 돌려준다.
 */
export interface ImageSize {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function ascii(b: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...b.subarray(start, start + length));
}

function pngSize(b: Uint8Array): ImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !signature.every((v, i) => b[i] === v)) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifSize(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || !ascii(b, 0, 4).startsWith('GIF8')) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  switch (ascii(b, 12, 4)) {
    case 'VP8 ':
      return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    case 'VP8L':
      return {
        width: (b[21] | ((b[22] & 0x3f) << 8)) + 1,
        height: ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)) + 1,
      };
    case 'VP8X':
      return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    default:
      return null;
  }
}

function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    // 표식 앞에 채움 바이트가 여러 개 올 수 있다.
    while (i + 1 < b.length && b[i + 1] === 0xff) i++;
    const marker = b[i + 1];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    // 길이가 없는 표식
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = u16be(b, i + 2);
    if (!(length >= 2)) return null;
    i += 2 + length;
  }
  return null;
}

export function imageSize(buf: Uint8Array): ImageSize | null {
  return pngSize(buf) ?? gifSize(buf) ?? webpSize(buf) ?? jpegSize(buf);
}
