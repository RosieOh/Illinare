import { Inflate, strFromU8 } from 'fflate';

/**
 * 사무 문서에서 본문 텍스트를 뽑는다. HWPX와 OOXML은 XML을 담은 ZIP이므로 별도 파서 없이 읽을 수 있다.
 *
 * 문서 내용은 신뢰할 수 없는 입력이고, 이 코드는 서버의 유일한 스레드에서 동기로 돈다.
 * 작은 파일로 서버를 멈추지 못하도록 모든 비용에 상한을 둔다.
 * - ZIP 목차를 직접 읽어 항목 수와 구조를 먼저 검사하고, 압축은 조금씩 풀며 실제 크기를 잰다.
 * - XML은 정규식 없이 앞으로만 가는 스캐너로 읽는다.
 * - 결과 글자 수(Budget)와 벽시계 시간(10초)을 모든 반복에서 확인한다.
 */

export type OfficeKind = 'hwpx' | 'docx' | 'pptx' | 'xlsx';

const OFFICE_KINDS: Record<string, OfficeKind> = {
  '.hwpx': 'hwpx',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
};

/** 구형 바이너리 형식. 읽지 못하니 무엇을 하면 되는지 알려준다. */
const LEGACY_HINTS: Record<string, string> = {
  '.hwp': '.hwp는 구형 바이너리 형식이라 읽을 수 없어요. 한글에서 HWPX로 다시 저장해 주세요.',
  '.doc': '.doc는 구형 바이너리 형식이라 읽을 수 없어요. Word에서 DOCX로 다시 저장해 주세요.',
  '.ppt': '.ppt는 구형 바이너리 형식이라 읽을 수 없어요. PowerPoint에서 PPTX로 다시 저장해 주세요.',
  '.xls': '.xls는 구형 바이너리 형식이라 읽을 수 없어요. Excel에서 XLSX로 다시 저장해 주세요.',
};

export function officeKindOf(extension: string): OfficeKind | null {
  return OFFICE_KINDS[extension.toLowerCase()] ?? null;
}

export function legacyHintOf(extension: string): string | null {
  return LEGACY_HINTS[extension.toLowerCase()] ?? null;
}

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 20000;
const MAX_SHEET_ROWS = 2000;
const MAX_SHEETS = 200;
const MAX_SLIDES = 1000;
const MAX_ROW_CELLS = 2000;
/** Excel 셀 하나의 글자 수 한계 */
const MAX_CELL_CHARS = 32767;
const MAX_SHARED_STRINGS = 1 << 20;
const MAX_FORMAT_CODE = 2048;
/** read_file이 200KB에서 자르므로 그 두 배까지만 만든다. */
const OUTPUT_LIMIT = 400 * 1024;
const DEADLINE_MS = 10000;
const INFLATE_CHUNK_BYTES = 16 * 1024;

const CORRUPT_MESSAGE = '문서를 열 수 없어요. 파일이 손상되었거나 암호가 걸려 있을 수 있어요.';
const TRUNCATED_NOTE = '\n…(문서가 길어 여기까지만 읽었어요)';

/** 사용자에게 그대로 보여줄 수 있는 오류 */
class DocumentError extends Error {}

/** 추출 한 번의 시간과 결과 크기 예산 */
class Budget {
  truncated = false;
  readonly limit: number;
  private remaining: number;
  private readonly deadline: number;
  private ticks = 0;

  constructor(deadlineMs: number, outputLimit: number) {
    this.deadline = Date.now() + deadlineMs;
    this.limit = outputLimit;
    this.remaining = outputLimit;
  }

  check(): void {
    if (Date.now() > this.deadline) {
      throw new DocumentError('문서를 읽는 데 시간이 너무 오래 걸려 멈췄어요. 내용을 나눠서 다시 저장해 주세요.');
    }
  }

  /** 반복마다 부른다. 시계는 가끔만 본다. */
  tick(): void {
    if ((++this.ticks & 1023) === 0) this.check();
  }

  get exhausted(): boolean {
    return this.remaining <= 0;
  }

  /** 남은 만큼만 잘라서 돌려주고 예산에서 뺀다. */
  take(text: string): string {
    if (text.length <= this.remaining) {
      this.remaining -= text.length;
      return text;
    }
    const clipped = text.slice(0, Math.max(0, this.remaining));
    this.remaining = 0;
    this.truncated = true;
    return clipped;
  }

  /** 다 읽지 못했음을 표시한다. */
  markTruncated(): void {
    this.truncated = true;
  }
}

// ─── ZIP ─────────────────────────────────────────────────────
const b2 = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8);
const b4 = (d: Uint8Array, i: number) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;
/** ZIP64 크기. 한계를 훨씬 넘는 값은 어차피 거부되므로 부동소수점 오차는 상관없다. */
const b8 = (d: Uint8Array, i: number) => b4(d, i) + b4(d, i + 4) * 4294967296;

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MIN_CENTRAL_RECORD = 46;
const U32_MAX = 0xffffffff;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  originalSize: number;
  offset: number;
  encrypted: boolean;
}

function corrupt(): DocumentError {
  return new DocumentError(CORRUPT_MESSAGE);
}

/** 목차 끝 레코드를 찾아 항목 수와 목차 위치를 돌려준다. 파일을 믿을 수 있는지 먼저 판단한다. */
function readEndOfCentralDirectory(d: Uint8Array): { count: number; offset: number } {
  if (d.length < 22) throw corrupt();
  let e = d.length - 22;
  while (b4(d, e) !== SIG_EOCD) {
    e--;
    if (e < 0 || d.length - e > 65558) throw corrupt();
  }
  let count = b2(d, e + 8);
  let offset = b4(d, e + 16);
  if (e >= 20 && b4(d, e - 20) === SIG_ZIP64_LOCATOR) {
    const record = b8(d, e - 12);
    if (record + 56 <= d.length && b4(d, record) === SIG_ZIP64_EOCD) {
      count = b8(d, record + 32);
      offset = b8(d, record + 48);
    }
  }
  if (count > MAX_ZIP_ENTRIES) throw new DocumentError('문서 안의 항목이 너무 많아서 읽지 않았어요.');
  // 목차 레코드는 최소 46바이트이므로 파일 크기보다 많은 항목을 담을 수 없다.
  if (count * MIN_CENTRAL_RECORD > d.length) throw corrupt();
  return { count, offset };
}

/** ZIP64 확장 필드에서 32비트로 표현할 수 없었던 값을 읽는다. */
function applyZip64(d: Uint8Array, start: number, end: number, entry: ZipEntry): void {
  let p = start;
  while (p + 4 <= end) {
    const id = b2(d, p);
    const size = b2(d, p + 2);
    if (id === 1) {
      let field = p + 4;
      if (entry.originalSize === U32_MAX) {
        entry.originalSize = b8(d, field);
        field += 8;
      }
      if (entry.compressedSize === U32_MAX) {
        entry.compressedSize = b8(d, field);
        field += 8;
      }
      if (entry.offset === U32_MAX) entry.offset = b8(d, field);
      return;
    }
    p += 4 + size;
  }
  throw corrupt();
}

function readCentralDirectory(d: Uint8Array, budget: Budget): ZipEntry[] {
  const { count, offset } = readEndOfCentralDirectory(d);
  const entries: ZipEntry[] = [];
  let o = offset;
  for (let i = 0; i < count; i++) {
    budget.tick();
    if (o + MIN_CENTRAL_RECORD > d.length || b4(d, o) !== SIG_CENTRAL) throw corrupt();
    const flags = b2(d, o + 8);
    const nameLength = b2(d, o + 28);
    const extraLength = b2(d, o + 30);
    const commentLength = b2(d, o + 32);
    const nameEnd = o + MIN_CENTRAL_RECORD + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (next > d.length) throw corrupt();
    const entry: ZipEntry = {
      name: strFromU8(d.subarray(o + MIN_CENTRAL_RECORD, nameEnd), !(flags & 0x800)),
      method: b2(d, o + 10),
      compressedSize: b4(d, o + 20),
      originalSize: b4(d, o + 24),
      offset: b4(d, o + 42),
      encrypted: (flags & 1) !== 0,
    };
    if (entry.originalSize === U32_MAX || entry.compressedSize === U32_MAX || entry.offset === U32_MAX) {
      applyZip64(d, nameEnd, nameEnd + extraLength, entry);
    }
    entries.push(entry);
    o = next;
  }
  return entries;
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * 항목 하나를 푼다. 목차의 크기를 믿지 않고 조금씩 풀면서 실제 크기와 시간을 잰다.
 * 압축률이 1000배를 넘을 수 있어서 한 번에 푸는 양이 곧 멈추는 시간이다.
 */
function inflateEntry(d: Uint8Array, entry: ZipEntry, budget: Budget, allowance: number): Uint8Array {
  if (entry.encrypted) throw corrupt();
  const local = entry.offset;
  if (local + 30 > d.length || b4(d, local) !== SIG_LOCAL) throw corrupt();
  const start = local + 30 + b2(d, local + 26) + b2(d, local + 28);
  const end = start + entry.compressedSize;
  if (end > d.length) throw corrupt();

  if (entry.method === 0) {
    if (entry.compressedSize > allowance) throw new DocumentError('압축을 푼 문서가 너무 커서 읽지 않았어요.');
    return d.subarray(start, end);
  }
  if (entry.method !== 8) throw corrupt();

  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > allowance) throw new DocumentError('압축을 푼 문서가 너무 커서 읽지 않았어요.');
    // 목차가 말한 크기를 넘으면 조작된 파일이다.
    if (total > entry.originalSize) throw corrupt();
    chunks.push(chunk);
  });
  if (start === end) return new Uint8Array(0);
  for (let p = start; p < end; p += INFLATE_CHUNK_BYTES) {
    budget.check();
    const stop = Math.min(p + INFLATE_CHUNK_BYTES, end);
    inflater.push(d.subarray(p, stop), stop === end);
  }
  return joinChunks(chunks, total);
}

/** 필요한 항목만 크기를 확인하며 푼다. */
function unzipSelected(buf: Uint8Array, wanted: (name: string) => boolean, budget: Budget): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null);
  let used = 0;
  try {
    for (const entry of readCentralDirectory(buf, budget)) {
      budget.tick();
      if (!wanted(entry.name)) continue;
      if (entry.originalSize > MAX_ENTRY_BYTES || used + entry.originalSize > MAX_TOTAL_BYTES) {
        throw new DocumentError('압축을 푼 문서가 너무 커서 읽지 않았어요.');
      }
      const data = inflateEntry(buf, entry, budget, Math.min(MAX_ENTRY_BYTES, MAX_TOTAL_BYTES - used));
      used += data.length;
      files[entry.name] = data;
    }
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    throw corrupt();
  }
  return files;
}

// ─── XML ─────────────────────────────────────────────────────
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, body: string) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

function localName(tag: string): string {
  const colon = tag.indexOf(':');
  return colon === -1 ? tag : tag.slice(colon + 1);
}

interface XmlHandler {
  /** attrs는 태그 이름 뒤의 원문. false를 돌려주면 읽기를 멈춘다. */
  open?: (name: string, attrs: string, selfClosing: boolean) => boolean | void;
  close?: (name: string) => boolean | void;
  /** 엔티티를 풀지 않은 원문 */
  text?: (raw: string) => boolean | void;
  cdata?: (text: string) => boolean | void;
}

function isNameChar(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 58 || // :
    c === 95 || // _
    c === 45 || // -
    c === 46 || // .
    c >= 128
  );
}

/**
 * 앞으로만 가는 XML 스캐너. 위치가 되돌아가지 않으므로 입력 길이에 비례해서 끝난다.
 * 닫는 표시를 찾지 못하면 그 뒤로는 태그가 있을 수 없으니 거기서 멈춘다.
 */
function scanXml(xml: string, budget: Budget, handler: XmlHandler): void {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    budget.tick();
    const lt = xml.indexOf('<', i);
    const textEnd = lt === -1 ? n : lt;
    if (textEnd > i && handler.text && handler.text(xml.slice(i, textEnd)) === false) return;
    if (lt === -1) return;

    const next = xml.charCodeAt(lt + 1);
    if (next === 33 /* ! */) {
      if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (end === -1) return;
        if (handler.cdata && handler.cdata(xml.slice(lt + 9, end)) === false) return;
        i = end + 3;
      } else if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        if (end === -1) return;
        i = end + 3;
      } else {
        const end = xml.indexOf('>', lt + 2);
        if (end === -1) return;
        i = end + 1;
      }
      continue;
    }
    if (next === 63 /* ? */) {
      const end = xml.indexOf('?>', lt + 2);
      if (end === -1) return;
      i = end + 2;
      continue;
    }

    const closing = next === 47; /* / */
    const nameStart = lt + (closing ? 2 : 1);
    let p = nameStart;
    while (p < n && isNameChar(xml.charCodeAt(p))) p++;
    if (p === nameStart) {
      // 태그가 아닌 < 문자
      i = lt + 1;
      continue;
    }

    // 속성값 안의 >는 태그의 끝이 아니다.
    let quote = 0;
    let q = p;
    for (; q < n; q++) {
      const c = xml.charCodeAt(q);
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) {
        quote = c;
      } else if (c === 62) {
        break;
      }
      if ((q & 0xfffff) === 0) budget.check();
    }
    if (q >= n) return;

    const name = xml.slice(nameStart, p);
    if (closing) {
      if (handler.close && handler.close(name) === false) return;
    } else if (handler.open) {
      const selfClosing = q > p && xml.charCodeAt(q - 1) === 47;
      if (handler.open(name, xml.slice(p, selfClosing ? q - 1 : q), selfClosing) === false) return;
    }
    i = q + 1;
  }
}

/** 태그 원문에서 속성 하나를 읽는다. 한 번 지나가며 찾는다. */
function attr(attrs: string, name: string): string | null {
  const n = attrs.length;
  const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(attrs.charCodeAt(i))) i++;
    const keyStart = i;
    while (i < n && attrs.charCodeAt(i) !== 61 /* = */ && !isSpace(attrs.charCodeAt(i))) i++;
    const keyEnd = i;
    while (i < n && isSpace(attrs.charCodeAt(i))) i++;
    if (attrs.charCodeAt(i) !== 61) {
      if (i === keyStart) i++;
      continue;
    }
    i++;
    while (i < n && isSpace(attrs.charCodeAt(i))) i++;
    const quote = attrs.charCodeAt(i);
    if (quote !== 34 && quote !== 39) continue;
    const end = attrs.indexOf(attrs[i], i + 1);
    if (end === -1) return null;
    if (keyEnd - keyStart === name.length && attrs.startsWith(name, keyStart)) {
      return decodeEntities(attrs.slice(i + 1, end));
    }
    i = end + 1;
  }
  return null;
}

/**
 * HWPX(hp:*), DOCX(w:*), PPTX(a:*)는 태그 구조가 거의 같다.
 * t 안의 글자를 모으고, 문단은 줄로, 표는 셀 구분자로 옮긴다.
 */
function flowText(xml: string, budget: Budget): string {
  const out: string[] = [];
  const outputLimit = budget.limit;
  let textDepth = 0;
  let cellDepth = 0;
  // 대체 콘텐츠(mc:Fallback)는 본문의 중복이고, w:tabs는 탭 위치 정의라 글자가 아니다.
  let fallbackDepth = 0;
  let tabStopsDepth = 0;

  /** 예산을 넘으면 false를 돌려줘 읽기를 멈춘다. */
  const push = (s: string): boolean => {
    out.push(budget.take(s));
    return !budget.exhausted;
  };
  const capture = (s: string): boolean | void => {
    if (textDepth > 0 && fallbackDepth === 0) return push(s);
  };

  scanXml(xml, budget, {
    // 엔티티를 풀면 글자 수는 줄어든다. 예산 밖의 원문은 풀지 않는다.
    text: (raw) => capture(decodeEntities(raw.length > outputLimit ? raw.slice(0, outputLimit + 1) : raw)),
    cdata: (text) => capture(text),
    open(tag, _attrs, selfClosing) {
      const name = localName(tag);
      if (name === 'Fallback') {
        if (!selfClosing) fallbackDepth++;
        return;
      }
      if (fallbackDepth > 0) return;
      if (name === 'tabs') {
        if (!selfClosing) tabStopsDepth++;
      } else if (name === 't') {
        if (!selfClosing) textDepth++;
      } else if (name === 'tab') {
        if (tabStopsDepth === 0) return push('\t');
      } else if (name === 'nbSpace' || name === 'fwSpace') {
        return push(' ');
      } else if (name === 'br' || name === 'lineBreak') {
        return push(cellDepth > 0 ? ' ' : '\n');
      } else if (name === 'tc' && !selfClosing) {
        cellDepth++;
      }
    },
    close(tag) {
      const name = localName(tag);
      if (name === 'Fallback') {
        fallbackDepth = Math.max(0, fallbackDepth - 1);
        return;
      }
      if (fallbackDepth > 0) return;
      if (name === 'tabs') {
        tabStopsDepth = Math.max(0, tabStopsDepth - 1);
      } else if (name === 't') {
        textDepth = Math.max(0, textDepth - 1);
      } else if (name === 'tc') {
        cellDepth = Math.max(0, cellDepth - 1);
        return push(cellDepth > 0 ? ' ' : ' | ');
      } else if (name === 'tr') {
        if (cellDepth === 0) return push('\n');
      } else if (name === 'p') {
        return push(cellDepth > 0 ? ' ' : '\n');
      }
    },
  });
  return tidy(out.join(''), budget);
}

const isBlank = (c: number) => c === 32 || c === 9;

/** 표 구분자 앞뒤의 공백을 ` | ` 하나로 모은다. 양쪽 모두 공백일 때만 구분자로 본다. */
function normalizePipes(line: string): string {
  if (!line.includes('|')) return line;
  const parts: string[] = [];
  const n = line.length;
  let chunkStart = 0;
  let i = 0;
  while (i < n) {
    if (!isBlank(line.charCodeAt(i))) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && isBlank(line.charCodeAt(j))) j++;
    if (line.charCodeAt(j) === 124 /* | */ && isBlank(line.charCodeAt(j + 1))) {
      let k = j + 1;
      while (k < n && isBlank(line.charCodeAt(k))) k++;
      parts.push(line.slice(chunkStart, i), ' | ');
      i = k;
      chunkStart = k;
    } else {
      i = j;
    }
  }
  parts.push(line.slice(chunkStart));
  return parts.join('');
}

/** 줄 끝의 공백과 표 구분자 하나를 지운다. */
function trimLineEnd(line: string): string {
  let end = line.length;
  while (end > 0 && isBlank(line.charCodeAt(end - 1))) end--;
  if (end > 0 && line.charCodeAt(end - 1) === 124) {
    end--;
    while (end > 0 && isBlank(line.charCodeAt(end - 1))) end--;
  }
  return line.slice(0, end);
}

/** 줄 단위로 정리한다. 공백이 아주 길어도 입력 길이에 비례해서 끝난다. */
function tidy(text: string, budget: Budget): string {
  const out: string[] = [];
  let blank = false;
  for (const raw of text.split('\n')) {
    budget.tick();
    const line = trimLineEnd(normalizePipes(raw));
    if (line === '') {
      // 빈 줄은 연속으로 하나까지만 남긴다.
      if (!blank) out.push('');
      blank = true;
    } else {
      out.push(line);
      blank = false;
    }
  }
  return out.join('\n').trim();
}

function numberIn(name: string): number {
  const match = name.match(/(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function sortedByNumber(names: string[]): string[] {
  return [...names].sort((a, b) => numberIn(a) - numberIn(b));
}

function finish(body: string, budget: Budget): string {
  return budget.truncated ? `${body}${TRUNCATED_NOTE}` : body;
}

function fromHwpx(buf: Uint8Array, budget: Budget): string {
  const isSection = (name: string) => /^Contents\/section\d+\.xml$/i.test(name);
  const files = unzipSelected(buf, isSection, budget);
  const names = sortedByNumber(Object.keys(files));
  if (names.length === 0) throw new DocumentError('HWPX 본문을 찾지 못했어요. 파일이 손상되었을 수 있어요.');
  const parts: string[] = [];
  for (const name of names) {
    if (budget.exhausted) {
      budget.markTruncated();
      break;
    }
    parts.push(flowText(strFromU8(files[name]), budget));
  }
  return finish(parts.join('\n\n'), budget);
}

function fromDocx(buf: Uint8Array, budget: Budget): string {
  const files = unzipSelected(buf, (name) => name === 'word/document.xml', budget);
  const body = files['word/document.xml'];
  if (!body) throw new DocumentError('DOCX 본문을 찾지 못했어요. 파일이 손상되었을 수 있어요.');
  return finish(flowText(strFromU8(body), budget), budget);
}

/** _rels 파일을 관계 id → 패키지 경로로 읽는다. target은 baseDir 기준 상대 경로이거나 / 로 시작한다. */
function relationships(data: Uint8Array | undefined, baseDir: string, budget: Budget): Map<string, string> {
  const rels = new Map<string, string>();
  if (!data) return rels;
  scanXml(strFromU8(data), budget, {
    open(tag, attrs) {
      if (localName(tag) !== 'Relationship') return;
      const id = attr(attrs, 'Id');
      const target = attr(attrs, 'Target');
      if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : baseDir + '/' + target);
    },
  });
  return rels;
}

/** 같은 대상을 여러 번 가리켜도 한 번만 읽고, 개수에 상한을 둔다. */
function uniqueCapped<T>(items: T[], key: (item: T) => string, max: number): { items: T[]; capped: boolean } {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    if (out.length >= max) return { items: out, capped: true };
    seen.add(k);
    out.push(item);
  }
  return { items: out, capped: false };
}

function fromPptx(buf: Uint8Array, budget: Budget): string {
  const files = unzipSelected(
    buf,
    (name) => name === 'ppt/presentation.xml' || name === 'ppt/_rels/presentation.xml.rels' || /^ppt\/slides\/slide\d+\.xml$/.test(name),
    budget
  );
  // 슬라이드를 옮기면 파일 번호와 표시 순서가 달라진다. 순서는 presentation.xml이 정한다.
  const rels = relationships(files['ppt/_rels/presentation.xml.rels'], 'ppt', budget);
  const ordered: string[] = [];
  if (files['ppt/presentation.xml']) {
    scanXml(strFromU8(files['ppt/presentation.xml']), budget, {
      open(tag, attrs) {
        if (localName(tag) !== 'sldId') return;
        const target = rels.get(attr(attrs, 'r:id') ?? '');
        if (target && files[target]) ordered.push(target);
      },
    });
  }
  const candidates = ordered.length > 0 ? ordered : sortedByNumber(Object.keys(files).filter((n) => n.startsWith('ppt/slides/')));
  const { items: names, capped } = uniqueCapped(candidates, (name) => name, MAX_SLIDES);
  if (names.length === 0) throw new DocumentError('PPTX 슬라이드를 찾지 못했어요. 파일이 손상되었을 수 있어요.');
  if (capped) budget.markTruncated();
  const parts: string[] = [];
  for (const [i, name] of names.entries()) {
    if (budget.exhausted) {
      budget.markTruncated();
      break;
    }
    parts.push(budget.take(`[슬라이드 ${i + 1}]\n`) + flowText(strFromU8(files[name]), budget));
  }
  return finish(parts.join('\n\n'), budget);
}

function sharedStrings(data: Uint8Array | undefined, budget: Budget): string[] {
  if (!data) return [];
  const items: string[] = [];
  let current: string[] | null = null;
  let currentLength = 0;
  let inText = false;
  // rPh는 일본어 읽기 표기이므로 본문이 아니다.
  let phoneticDepth = 0;

  const flush = () => {
    if (current && items.length < MAX_SHARED_STRINGS) items.push(current.join(''));
    current = null;
    currentLength = 0;
    inText = false;
    phoneticDepth = 0;
  };
  const append = (text: string) => {
    if (!current || !inText || phoneticDepth > 0 || currentLength >= MAX_CELL_CHARS) return;
    const piece = text.slice(0, MAX_CELL_CHARS - currentLength);
    current.push(piece);
    currentLength += piece.length;
  };

  scanXml(strFromU8(data), budget, {
    open(tag, _attrs, selfClosing) {
      const name = localName(tag);
      if (name === 'si') {
        flush();
        if (selfClosing) {
          // 빈 항목도 번호를 차지한다.
          if (items.length < MAX_SHARED_STRINGS) items.push('');
        } else {
          current = [];
        }
      } else if (name === 'rPh') {
        if (!selfClosing) phoneticDepth++;
      } else if (name === 't' && !selfClosing) {
        inText = true;
      }
    },
    close(tag) {
      const name = localName(tag);
      if (name === 'si') flush();
      else if (name === 'rPh') phoneticDepth = Math.max(0, phoneticDepth - 1);
      else if (name === 't') inText = false;
    },
    text: (raw) => append(decodeEntities(raw.slice(0, MAX_CELL_CHARS * 8))),
    cdata: (text) => append(text),
  });
  flush();
  return items;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** 스타일 번호 중 날짜 서식인 것을 고른다. 엑셀은 날짜를 숫자로 저장하고 서식으로만 구분한다. */
function dateStyles(data: Uint8Array | undefined, budget: Budget): Set<number> {
  const result = new Set<number>();
  if (!data) return result;
  const custom = new Set<number>();
  const xfFormats: number[] = [];
  let inCellXfs = false;
  scanXml(strFromU8(data), budget, {
    open(tag, attrs, selfClosing) {
      const name = localName(tag);
      if (name === 'numFmt') {
        // 서식 문자열 정리는 정규식이므로 길이를 먼저 제한한다.
        const code = attr(attrs, 'formatCode') ?? '';
        if (code.length <= MAX_FORMAT_CODE) {
          // 따옴표와 대괄호 안은 글자나 색 지정이므로 빼고 날짜 기호를 찾는다.
          const stripped = code.replace(/"[^"]*"|\[[^\]]*\]/g, '');
          if (/[ymdh]/i.test(stripped)) custom.add(Number(attr(attrs, 'numFmtId')));
        }
      } else if (name === 'cellXfs') {
        inCellXfs = !selfClosing;
      } else if (name === 'xf' && inCellXfs) {
        xfFormats.push(Number(attr(attrs, 'numFmtId') ?? 0));
      }
    },
    close(tag) {
      if (localName(tag) === 'cellXfs') inCellXfs = false;
    },
  });
  xfFormats.forEach((id, index) => {
    if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) result.add(index);
  });
  return result;
}

function serialToDate(serial: number, date1904: boolean): string | null {
  const base = Date.UTC(1899, 11, 30) + (date1904 ? 1462 * 86400000 : 0);
  const date = new Date(base + Math.round(serial * 86400000));
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 10) + ' ' + iso.slice(11, 16);
}

/** "AB12" → 27 (0부터). 형식이 다르면 null */
function columnIndex(ref: string | null): number | null {
  if (!ref || ref.length > 16) return null;
  const letters = ref.match(/^([A-Z]+)\d+$/i)?.[1]?.toUpperCase();
  if (!letters) return null;
  let index = 0;
  for (const c of letters) index = index * 26 + (c.charCodeAt(0) - 64);
  return index - 1;
}

/** 시트 XML을 탭으로 구분한 행으로 바꾼다. 빈 셀은 XML에서 생략되므로 열 번호로 자리를 맞춘다. */
function sheetRows(
  xml: string,
  strings: string[],
  dates: Set<number>,
  date1904: boolean,
  budget: Budget
): { rows: string[]; rowLimit: boolean; cellLimit: boolean } {
  const rows: string[] = [];
  let rowLimit = false;
  let cellLimit = false;
  let cells: string[] | null = null;

  interface OpenCell {
    attrs: string;
    type: string | null;
    value: string | null;
    inline: string[];
    inlineLength: number;
    capture: 'v' | 't' | null;
    phoneticDepth: number;
  }
  let cell: OpenCell | null = null;

  const cellValue = (c: OpenCell): string => {
    if (c.type === 'inlineStr') return c.inline.join('');
    const raw = c.value;
    if (raw === null) return '';
    if (c.type === 's') return strings[Number(raw)] ?? '';
    if ((!c.type || c.type === 'n') && raw !== '' && Number.isFinite(Number(raw)) && dates.has(Number(attr(c.attrs, 's') ?? -1))) {
      return serialToDate(Number(raw), date1904) ?? raw;
    }
    return decodeEntities(raw);
  };

  const finishCell = () => {
    if (!cell || !cells) {
      cell = null;
      return;
    }
    const value = cellValue(cell).slice(0, MAX_CELL_CHARS);
    const column = columnIndex(attr(cell.attrs, 'r'));
    if (column !== null) {
      // 잘못된 참조로 메모리를 쓰지 않도록 열 번호에 상한을 둔다.
      if (column < MAX_ROW_CELLS) {
        while (cells.length < column) cells.push('');
        cells[column] = value;
      } else {
        cellLimit = true;
      }
    } else if (cells.length < MAX_ROW_CELLS) {
      cells.push(value);
    } else {
      cellLimit = true;
    }
    cell = null;
  };

  /** 행을 끝낸다. 더 읽을 수 없으면 false */
  const finishRow = (): boolean => {
    finishCell();
    const row = cells;
    cells = null;
    if (!row || !row.some(Boolean)) return true;
    const line = budget.take(row.join('\t'));
    rows.push(line);
    budget.take('\n');
    return !budget.exhausted;
  };

  scanXml(xml, budget, {
    open(tag, attrs, selfClosing) {
      const name = localName(tag);
      if (name === 'row') {
        if (!finishRow()) return false;
        if (rows.length >= MAX_SHEET_ROWS) {
          rowLimit = true;
          return false;
        }
        if (!selfClosing) cells = [];
      } else if (name === 'c') {
        finishCell();
        if (!cells) return;
        cell = { attrs, type: attr(attrs, 't'), value: null, inline: [], inlineLength: 0, capture: null, phoneticDepth: 0 };
        if (selfClosing) finishCell();
      } else if (cell) {
        if (name === 'v' && !selfClosing && cell.value === null) {
          cell.capture = 'v';
          cell.value = '';
        } else if (name === 't' && !selfClosing && cell.type === 'inlineStr') {
          cell.capture = 't';
        } else if (name === 'rPh' && !selfClosing) {
          cell.phoneticDepth++;
        }
      }
    },
    close(tag) {
      const name = localName(tag);
      if (name === 'row') return finishRow();
      if (name === 'c') {
        finishCell();
      } else if (cell) {
        if (name === 'v' || name === 't') cell.capture = null;
        else if (name === 'rPh') cell.phoneticDepth = Math.max(0, cell.phoneticDepth - 1);
      }
    },
    text(raw) {
      if (!cell || cell.capture === null) return;
      if (cell.capture === 'v') {
        if (cell.value !== null && cell.value.length < MAX_CELL_CHARS) cell.value += raw.slice(0, MAX_CELL_CHARS);
      } else if (cell.phoneticDepth === 0 && cell.inlineLength < MAX_CELL_CHARS) {
        const piece = decodeEntities(raw.slice(0, MAX_CELL_CHARS));
        cell.inline.push(piece);
        cell.inlineLength += piece.length;
      }
    },
    cdata(text) {
      if (cell?.capture === 't' && cell.phoneticDepth === 0 && cell.inlineLength < MAX_CELL_CHARS) {
        cell.inline.push(text.slice(0, MAX_CELL_CHARS));
        cell.inlineLength += text.length;
      }
    },
  });
  finishRow();
  return { rows, rowLimit, cellLimit };
}

function fromXlsx(buf: Uint8Array, budget: Budget): string {
  const files = unzipSelected(
    buf,
    (name) =>
      name === 'xl/workbook.xml' ||
      name === 'xl/sharedStrings.xml' ||
      name === 'xl/styles.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    budget
  );
  const strings = sharedStrings(files['xl/sharedStrings.xml'], budget);
  const dates = dateStyles(files['xl/styles.xml'], budget);

  // 시트 이름과 순서는 workbook.xml, 실제 파일은 관계 정의를 따라간다.
  const rels = relationships(files['xl/_rels/workbook.xml.rels'], 'xl', budget);
  let date1904 = false;
  const listed: { name: string; file: string }[] = [];
  if (files['xl/workbook.xml']) {
    scanXml(strFromU8(files['xl/workbook.xml']), budget, {
      open(tag, attrs) {
        const name = localName(tag);
        if (name === 'workbookPr') {
          const value = attr(attrs, 'date1904');
          date1904 = value === '1' || value === 'true';
        } else if (name === 'sheet') {
          const target = rels.get(attr(attrs, 'r:id') ?? '');
          if (target && files[target]) listed.push({ name: (attr(attrs, 'name') ?? '시트').slice(0, 100), file: target });
        }
      },
    });
  }
  if (listed.length === 0) {
    sortedByNumber(Object.keys(files).filter((n) => n.startsWith('xl/worksheets/'))).forEach((file, i) =>
      listed.push({ name: `시트 ${i + 1}`, file })
    );
  }
  // 같은 시트를 수만 번 가리키는 파일이 있다. 파일마다 한 번만 읽는다.
  const { items: sheets, capped } = uniqueCapped(listed, (sheet) => sheet.file, MAX_SHEETS);
  if (sheets.length === 0) throw new DocumentError('XLSX 시트를 찾지 못했어요. 파일이 손상되었을 수 있어요.');
  if (capped) budget.markTruncated();

  const parts: string[] = [];
  for (const { name, file } of sheets) {
    if (budget.exhausted) {
      budget.markTruncated();
      break;
    }
    const header = budget.take(`[시트: ${name}]\n`);
    const { rows, rowLimit, cellLimit } = sheetRows(strFromU8(files[file]), strings, dates, date1904, budget);
    const notes = [
      rowLimit ? `\n…(${MAX_SHEET_ROWS}행까지만 읽음)` : '',
      cellLimit ? `\n…(행마다 ${MAX_ROW_CELLS}칸까지만 읽음)` : '',
    ].join('');
    parts.push(`${header}${rows.join('\n')}${notes}`);
  }
  return finish(parts.join('\n\n'), budget);
}

export interface ExtractOptions {
  /** 테스트용. 기본 10초 */
  deadlineMs?: number;
  /** 테스트용. 기본 400KB */
  outputLimit?: number;
}

export function extractOfficeText(kind: OfficeKind, buf: Uint8Array, options: ExtractOptions = {}): string {
  const budget = new Budget(options.deadlineMs ?? DEADLINE_MS, options.outputLimit ?? OUTPUT_LIMIT);
  try {
    switch (kind) {
      case 'hwpx':
        return fromHwpx(buf, budget);
      case 'docx':
        return fromDocx(buf, budget);
      case 'pptx':
        return fromPptx(buf, budget);
      case 'xlsx':
        return fromXlsx(buf, budget);
    }
  } catch (err) {
    if (err instanceof DocumentError) throw err;
    // 스택 오버플로, 범위 오류 같은 내부 오류를 영어 그대로 내보내지 않는다.
    throw corrupt();
  }
}
