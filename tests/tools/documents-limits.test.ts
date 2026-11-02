import { deflateRawSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractOfficeText, type OfficeKind } from '@/lib/tools/documents';
import { imageSize } from '@/lib/tools/images';

/** 예전 코드는 이 입력들에서 수십 초 멈추거나 메모리가 터졌다. 넉넉하게 잡아도 한참 아래여야 한다. */
const LIMIT_MS = 8000;

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

function run(kind: OfficeKind, buf: Uint8Array): { text: string | null; error: string | null; ms: number } {
  const start = Date.now();
  try {
    return { text: extractOfficeText(kind, buf), error: null, ms: Date.now() - start };
  } catch (err) {
    return { text: null, error: (err as Error).message, ms: Date.now() - start };
  }
}

const hasKorean = (s: string | null) => /[가-힣]/.test(s ?? '');

describe('XML 스캐너: 멈추지 않는다', () => {
  it("재현: '<a '가 16만 번 반복돼도 금방 끝난다", () => {
    const r = run('docx', zip({ 'word/document.xml': '<a '.repeat(160000) }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
  }, 30000);

  it('재현: 공백 20만 개를 금방 정리한다', () => {
    const r = run('docx', zip({ 'word/document.xml': `<w:t>${' '.repeat(200000)}x</w:t>` }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text).toBe('x');
  }, 30000);

  it('줄 끝 공백과 표 구분자 앞의 긴 공백도 금방 정리한다', () => {
    const xml = `<w:t>a${' '.repeat(100000)}|${' '.repeat(100000)}b${' '.repeat(100000)}</w:t><w:br/><w:t>c</w:t>`;
    const r = run('docx', zip({ 'word/document.xml': xml }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text).toBe('a | b\nc');
  }, 30000);

  it.each([
    ['닫히지 않은 따옴표', '<a b="'.repeat(100000)],
    ['닫히지 않은 주석', '<!-- '.repeat(100000)],
    ['닫히지 않은 CDATA', '<![CDATA['.repeat(100000)],
    ['닫히지 않은 선언', '<?x '.repeat(100000)],
    ['태그가 아닌 부등호', '< '.repeat(200000)],
    ['엔티티 조각', `<w:t>${'&a'.repeat(200000)}</w:t>`],
  ])('%s', (_label, xml) => {
    const r = run('docx', zip({ 'word/document.xml': xml }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
  }, 30000);

  it.each([
    ['공유 문자열 <si>', { 'xl/sharedStrings.xml': '<si>'.repeat(80000), 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>' }],
    ['닫히지 않은 <row>', { 'xl/worksheets/sheet1.xml': '<row>'.repeat(80000) }],
    ['닫히지 않은 <c>', { 'xl/worksheets/sheet1.xml': `<row>${'<c>'.repeat(80000)}</row>` }],
    ['관계 정의', { 'xl/_rels/workbook.xml.rels': '<Relationship '.repeat(80000), 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>' }],
    ['통합 문서', { 'xl/workbook.xml': '<workbookPr '.repeat(80000), 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>' }],
    ['스타일', { 'xl/styles.xml': '<cellXfs '.repeat(80000), 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>' }],
  ])('XLSX %s', (_label, files) => {
    const r = run('xlsx', zip(files as Record<string, string>));
    expect(r.ms).toBeLessThan(LIMIT_MS);
  }, 30000);

  it('긴 서식 코드로 날짜 판별 정규식을 멈추지 못한다', () => {
    const r = run('xlsx', zip({
      'xl/styles.xml': `<numFmt numFmtId="164" formatCode="${'['.repeat(300000)}"/>`,
      'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>',
    }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text).toContain('1');
  }, 30000);
});

describe('ZIP 목차: 먼저 검사한다', () => {
  function zip64Count(count: number): Uint8Array {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeUInt32LE(count >>> 0, 32);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0xffff, 8);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 16);
    return Buffer.concat([record, locator, end]);
  }

  it('재현: 98바이트 파일이 zip64로 항목 40억 개를 주장해도 바로 거부한다', () => {
    const buf = zip64Count(0xffffffff);
    expect(buf.length).toBe(98);
    const r = run('docx', buf);
    expect(r.ms).toBeLessThan(500);
    expect(r.error).toMatch(/항목이 너무 많/);
  });

  it('2만 개를 넘는 항목을 거부한다', () => {
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(20001, 8);
    const r = run('docx', Buffer.concat([Buffer.alloc(46 * 20001), end]));
    expect(r.error).toMatch(/항목이 너무 많/);
  });

  it('파일에 담을 수 없는 항목 수를 거부한다', () => {
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(5000, 8);
    const r = run('docx', end);
    expect(r.error).toMatch(/손상|암호/);
  });

  /** 목차 하나짜리 ZIP을 직접 만든다. */
  function singleEntry(options: {
    name?: string;
    data: Buffer;
    method?: number;
    claimedSize: number;
    claimedCompressed?: number;
    flags?: number;
  }): Uint8Array {
    const name = Buffer.from(options.name ?? 'word/document.xml');
    const method = options.method ?? 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(options.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(options.claimedCompressed ?? options.data.length, 20);
    central.writeUInt32LE(options.claimedSize, 24);
    central.writeUInt16LE(name.length, 28);
    const offset = local.length + name.length + options.data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([local, name, options.data, central, name, end]);
  }

  it('목차가 크기를 속이면 다 풀기 전에 거부한다', () => {
    const data = deflateRawSync(Buffer.alloc(32 * 1024 * 1024, 0x20), { level: 9 });
    const r = run('docx', singleEntry({ data, claimedSize: 100 }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.error).toMatch(/손상|암호/);
  }, 30000);

  it('zip64 표시만 있고 확장 필드가 없으면 멈추지 않고 거부한다', () => {
    const r = run('docx', singleEntry({ data: Buffer.from('x'), claimedSize: 0xffffffff, claimedCompressed: 0xffffffff }));
    expect(r.ms).toBeLessThan(500);
    expect(r.error).toMatch(/손상|암호/);
  });

  it('암호 걸린 항목과 모르는 압축 방식을 거부한다', () => {
    expect(run('docx', singleEntry({ data: Buffer.from('x'), method: 0, claimedSize: 1, flags: 1 })).error).toMatch(/암호/);
    expect(run('docx', singleEntry({ data: Buffer.from('x'), method: 99, claimedSize: 1 })).error).toMatch(/손상|암호/);
  });

  it('무압축 항목과 일반 압축 항목을 그대로 읽는다', () => {
    const xml = Buffer.from('<w:t>무압축 본문</w:t>');
    expect(run('docx', singleEntry({ data: xml, method: 0, claimedSize: xml.length })).text).toBe('무압축 본문');
    expect(run('docx', singleEntry({ data: deflateRawSync(xml), claimedSize: xml.length })).text).toBe('무압축 본문');
  });

  it('목차 오프셋이 파일 밖이면 거부한다', () => {
    const buf = Buffer.from(singleEntry({ data: Buffer.from('x'), method: 0, claimedSize: 1 }));
    buf.writeUInt32LE(0xfffffff0, buf.length - 6);
    expect(run('docx', buf).error).toMatch(/손상|암호/);
  });
});

describe('결과 크기: 예산을 넘지 않는다', () => {
  const OUTPUT_LIMIT = 400 * 1024;

  it('재현: 같은 시트를 2만 번 가리켜도 한 번만 읽는다', () => {
    const r = run('xlsx', zip({
      'xl/workbook.xml': '<sheet name="s" r:id="rId1"/>'.repeat(20000),
      'xl/_rels/workbook.xml.rels': '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
      'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>'.repeat(2000),
    }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text?.match(/\[시트: s\]/g)).toHaveLength(1);
  }, 30000);

  it('시트는 200개까지만 읽고 알려준다', () => {
    const files: Record<string, string> = {};
    let sheets = '';
    let rels = '';
    for (let i = 1; i <= 250; i++) {
      sheets += `<sheet name="s${i}" r:id="rId${i}"/>`;
      rels += `<Relationship Id="rId${i}" Target="worksheets/sheet${i}.xml"/>`;
      files[`xl/worksheets/sheet${i}.xml`] = '<row><c><v>1</v></c></row>';
    }
    files['xl/workbook.xml'] = sheets;
    files['xl/_rels/workbook.xml.rels'] = rels;
    const text = run('xlsx', zip(files)).text;
    expect(text?.match(/\[시트: /g)).toHaveLength(200);
    expect(text).toContain('여기까지만 읽었어요');
  }, 30000);

  it('슬라이드도 중복을 한 번만 읽는다', () => {
    const r = run('pptx', zip({
      'ppt/presentation.xml': '<p:sldId r:id="rId1"/>'.repeat(20000),
      'ppt/_rels/presentation.xml.rels': '<Relationship Id="rId1" Target="slides/slide1.xml"/>',
      'ppt/slides/slide1.xml': '<a:t>본문</a:t>',
    }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text?.match(/\[슬라이드 /g)).toHaveLength(1);
  }, 30000);

  it('재현: 큰 공유 문자열을 셀마다 참조해도 메모리가 터지지 않는다', () => {
    const big = 'A'.repeat(5 * 1024 * 1024);
    const row = `<row>${'<c t="s"><v>0</v></c>'.repeat(8)}</row>`;
    const r = run('xlsx', zip({
      'xl/sharedStrings.xml': `<si><t>${big}</t></si>`,
      'xl/worksheets/sheet1.xml': row.repeat(2000),
    }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text!.length).toBeLessThan(OUTPUT_LIMIT + 200);
    expect(r.text).toContain('여기까지만 읽었어요');
  }, 30000);

  it('한 행의 칸 수와 열 번호에 상한이 있다', () => {
    const cells = Array.from({ length: 5000 }, () => '<c><v>1</v></c>').join('');
    const wide = run('xlsx', zip({ 'xl/worksheets/sheet1.xml': `<row>${cells}</row>` }));
    expect(wide.text?.split('\t')).toHaveLength(2000);
    expect(wide.text).toContain('2000칸까지만');

    const far = run('xlsx', zip({ 'xl/worksheets/sheet1.xml': '<row><c r="A1"><v>1</v></c><c r="ZZZZZ1"><v>2</v></c></row>' }));
    expect(far.text).toContain('1');
    expect(far.text).toContain('2000칸까지만');
  }, 30000);

  it('긴 본문은 예산에서 잘리고 알려준다', () => {
    const r = run('docx', zip({ 'word/document.xml': `<w:t>${'가'.repeat(2 * 1024 * 1024)}</w:t>` }));
    expect(r.text!.length).toBeLessThan(OUTPUT_LIMIT + 200);
    expect(r.text).toContain('여기까지만 읽었어요');
  }, 30000);

  it('문단이 많아도 예산에서 멈춘다', () => {
    const r = run('docx', zip({ 'word/document.xml': '<w:p><w:t>가</w:t></w:p>'.repeat(500000) }));
    expect(r.ms).toBeLessThan(LIMIT_MS);
    expect(r.text!.length).toBeLessThan(OUTPUT_LIMIT + 200);
  }, 30000);

  it('옵션으로 예산을 줄일 수 있다', () => {
    const text = extractOfficeText('docx', zip({ 'word/document.xml': `<w:t>${'가'.repeat(1000)}</w:t>` }), { outputLimit: 10 });
    expect(text.startsWith('가'.repeat(10))).toBe(true);
    expect(text).toContain('여기까지만 읽었어요');
  });
});

describe('시간 제한', () => {
  it('제한을 넘으면 한국어 오류로 멈춘다', () => {
    const xml = '<w:p><w:t>가</w:t></w:p>'.repeat(200000);
    expect(() => extractOfficeText('docx', zip({ 'word/document.xml': xml }), { deadlineMs: -1 })).toThrow(/시간이 너무 오래/);
  }, 30000);
});

describe('내부 오류를 영어로 내보내지 않는다', () => {
  it('관계가 객체 속성 이름을 가리켜도 안전하다', () => {
    const r = run('pptx', zip({
      'ppt/presentation.xml': '<p:sldId r:id="rId1"/>',
      'ppt/_rels/presentation.xml.rels': '<Relationship Id="rId1" Target="/constructor"/>',
      'ppt/slides/slide1.xml': '<a:t>본문</a:t>',
    }));
    expect(r.text).toContain('본문');
  });

  it('범위를 벗어난 날짜 값은 숫자 그대로 둔다', () => {
    const r = run('xlsx', zip({
      'xl/styles.xml': '<cellXfs><xf numFmtId="14"/></cellXfs>',
      'xl/worksheets/sheet1.xml': '<row><c s="0"><v>1e300</v></c></row>',
    }));
    expect(r.error).toBeNull();
    expect(r.text).toContain('1e300');
  });

  it('오류 메시지는 한국어이다', () => {
    expect(hasKorean(run('docx', Buffer.from('nope')).error)).toBe(true);
    expect(hasKorean(run('xlsx', zip({ 'a.txt': 'x' })).error)).toBe(true);
  });
});

describe('스캐너의 XML 처리', () => {
  it('속성값 안의 >를 태그 끝으로 보지 않는다', () => {
    const text = extractOfficeText('docx', zip({
      'word/document.xml': '<w:p w:rsidR="a>b"><w:r><w:t xml:space="preserve">A &amp; B &#xAC00; &lt;tag&gt;</w:t></w:r><w:r><w:t><![CDATA[ raw <cdata>]]></w:t></w:r></w:p>',
    }));
    expect(text).toBe('A & B 가 <tag> raw <cdata>');
  });

  it('주석과 선언을 본문으로 읽지 않는다', () => {
    const text = extractOfficeText('docx', zip({
      'word/document.xml': '<?xml version="1.0"?><!DOCTYPE x><w:t>본문<!-- 숨김 --></w:t>',
    }));
    expect(text).toBe('본문');
  });

  it('작은따옴표 속성을 읽는다', () => {
    const text = extractOfficeText('xlsx', zip({
      'xl/workbook.xml': "<sheet name='매출' r:id='rId1'/>",
      'xl/_rels/workbook.xml.rels': "<Relationship Id='rId1' Target='worksheets/sheet1.xml'/>",
      'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>',
    }));
    expect(text).toContain('[시트: 매출]');
  });
});

describe('imageSize', () => {
  it('PNG', () => {
    const b = Buffer.alloc(32);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.writeUInt32BE(9000, 16);
    b.writeUInt32BE(20, 20);
    expect(imageSize(b)).toEqual({ width: 9000, height: 20 });
  });

  it('GIF', () => {
    const b = Buffer.alloc(13);
    b.write('GIF89a', 0, 'latin1');
    b.writeUInt16LE(640, 6);
    b.writeUInt16LE(480, 8);
    expect(imageSize(b)).toEqual({ width: 640, height: 480 });
  });

  it('JPEG는 앞선 세그먼트를 건너뛰고 프레임 헤더를 찾는다', () => {
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, 0x27, 0x10, 0x01, 0x00, 0x03]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]))).toEqual({ width: 256, height: 10000 });
  });

  it('WEBP 세 종류', () => {
    const base = (tag: string) => {
      const b = Buffer.alloc(40);
      b.write('RIFF', 0, 'latin1');
      b.write('WEBP', 8, 'latin1');
      b.write(tag, 12, 'latin1');
      return b;
    };
    const lossy = base('VP8 ');
    lossy.writeUInt16LE(800, 26);
    lossy.writeUInt16LE(600, 28);
    expect(imageSize(lossy)).toEqual({ width: 800, height: 600 });

    const extended = base('VP8X');
    extended.writeUIntLE(9999, 24, 3);
    extended.writeUIntLE(99, 27, 3);
    expect(imageSize(extended)).toEqual({ width: 10000, height: 100 });

    const lossless = base('VP8L');
    lossless[20] = 0x2f;
    // 너비 100, 높이 200 (각각 -1 해서 14비트씩)
    const bits = (100 - 1) | ((200 - 1) << 14);
    lossless.writeUInt32LE(bits, 21);
    expect(imageSize(lossless)).toEqual({ width: 100, height: 200 });
  });

  it('알아볼 수 없으면 null이고 깨진 JPEG에서 멈추지 않는다', () => {
    expect(imageSize(Buffer.from('fake'))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]))).toBeNull();
    expect(imageSize(Buffer.alloc(0))).toBeNull();
  });
});
