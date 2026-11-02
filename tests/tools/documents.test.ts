import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { decodeEntities, extractOfficeText, legacyHintOf, officeKindOf } from '@/lib/tools/documents';
import { getTool } from '@/lib/tools';
import type { ToolOutcome } from '@/lib/tools/registry';

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('extractOfficeText', () => {
  it('HWPX 문단, 표, 엔티티, 구역 순서를 살린다', () => {
    const section0 = `<?xml version="1.0"?><hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>첫 문단 &amp; 끝</hp:t></hp:run></hp:p>
      <hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t>금액</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p></hs:sec>`;
    const section10 = `<hs:sec><hp:p><hp:run><hp:t>마지막 구역</hp:t></hp:run></hp:p></hs:sec>`;
    const section2 = `<hs:sec><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>`;
    const text = extractOfficeText(
      'hwpx',
      zip({
        'Contents/section10.xml': section10,
        'Contents/section0.xml': section0,
        'Contents/section2.xml': section2,
        'Contents/header.xml': '<hp:t>머리말 정의는 본문이 아님</hp:t>',
      })
    );
    expect(text).toContain('첫 문단 & 끝');
    expect(text).toContain('항목 | 금액');
    expect(text).not.toContain('머리말 정의');
    expect(text.indexOf('둘째 구역')).toBeLessThan(text.indexOf('마지막 구역'));
  });

  it('DOCX 문단과 탭과 줄바꿈을 살린다', () => {
    const text = extractOfficeText(
      'docx',
      zip({
        'word/document.xml':
          '<w:document><w:body><w:p><w:r><w:t>안녕</w:t><w:tab/><w:t xml:space="preserve">하세요 </w:t><w:br/><w:t>둘째 줄</w:t></w:r></w:p></w:body></w:document>',
      })
    );
    expect(text).toBe('안녕\t하세요\n둘째 줄');
  });

  it('PPTX 슬라이드를 번호 순서대로 읽는다', () => {
    const text = extractOfficeText(
      'pptx',
      zip({
        'ppt/slides/slide10.xml': '<p:sld><a:p><a:r><a:t>열 번째</a:t></a:r></a:p></p:sld>',
        'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>두 번째</a:t></a:r></a:p></p:sld>',
      })
    );
    expect(text.indexOf('두 번째')).toBeLessThan(text.indexOf('열 번째'));
    expect(text).toContain('[슬라이드 1]\n두 번째');
  });

  it('XLSX 공유 문자열, 인라인 문자열, 숫자, 시트 이름을 읽는다', () => {
    const text = extractOfficeText(
      'xlsx',
      zip({
        'xl/workbook.xml': '<workbook><sheets><sheet name="매출 &amp; 비용" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/sharedStrings.xml': '<sst><si><t>항목</t></si><si><r><t>금</t></r><r><t>액</t></r></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>광고</t></is></c><c r="B2"><v>1200</v></c></row></sheetData></worksheet>',
      })
    );
    expect(text).toContain('[시트: 매출 & 비용]');
    expect(text).toContain('항목\t금액');
    expect(text).toContain('광고\t1200');
  });

  it('ZIP이 아니면 원인을 알려주는 오류를 낸다', () => {
    expect(() => extractOfficeText('docx', strToU8('이것은 문서가 아닙니다'))).toThrow(/손상|암호/);
  });

  it('본문이 없는 ZIP을 거부한다', () => {
    expect(() => extractOfficeText('hwpx', zip({ 'mimetype': 'x' }))).toThrow(/찾지 못했어요/);
  });

  it('엔티티를 안전하게 푼다', () => {
    expect(decodeEntities('&lt;a&gt; &#65; &#xAC00; &unknown; &#x110000;')).toBe('<a> A 가 &unknown; &#x110000;');
  });

  it('형식을 판별한다', () => {
    expect(officeKindOf('.HWPX')).toBe('hwpx');
    expect(officeKindOf('.txt')).toBeNull();
    expect(legacyHintOf('.hwp')).toContain('HWPX');
    expect(legacyHintOf('.pdf')).toBeNull();
  });
});

describe('read_file 문서 처리', () => {
  const dir = mkdtempSync(join(homedir(), 'illionaire-doc-test-'));
  const tool = getTool('read_file')!;
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('HWPX 본문을 돌려준다', async () => {
    const path = join(dir, '기안문.hwpx');
    writeFileSync(path, zip({ 'Contents/section0.xml': '<hp:p><hp:t>제목: 예산 승인</hp:t></hp:p>' }));
    const out = await tool.run({ path }, {});
    expect(String(out)).toContain('제목: 예산 승인');
  });

  it('PDF는 첨부로 돌려주고 본문 문자열에 넣지 않는다', async () => {
    const path = join(dir, '보고서.pdf');
    writeFileSync(path, '%PDF-1.4 test');
    const out = (await tool.run({ path }, {})) as ToolOutcome;
    expect(out.attachment?.kind).toBe('pdf');
    expect(out.attachment?.data).toBe(Buffer.from('%PDF-1.4 test').toString('base64'));
    expect(out.content).not.toContain('%PDF');
  });

  it('이미지는 올바른 media type으로 첨부한다', async () => {
    const path = join(dir, '화면.JPG');
    writeFileSync(path, 'fake');
    const out = (await tool.run({ path }, {})) as ToolOutcome;
    expect(out.attachment).toMatchObject({ kind: 'image', mediaType: 'image/jpeg' });
  });

  it('구형 HWP는 변환 방법을 알려준다', async () => {
    const path = join(dir, '옛문서.hwp');
    writeFileSync(path, 'x');
    await expect(tool.run({ path }, {})).rejects.toThrow(/HWPX로 다시 저장/);
  });
});
