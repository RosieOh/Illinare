import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractOfficeText } from '@/lib/tools/documents';

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('문서 구조의 까다로운 경우', () => {
  it('XLSX 빈 셀이 있어도 열이 밀리지 않는다', () => {
    const text = extractOfficeText(
      'xlsx',
      zip({
        'xl/sharedStrings.xml': '<sst><si><t>이름</t></si><si><t>Q1</t></si><si><t>Q3</t></si><si><t>김</t></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="D2"><v>300</v></c></row></sheetData></worksheet>',
      })
    );
    expect(text).toContain('이름\tQ1\t\tQ3');
    expect(text).toContain('김\t\t\t300');
  });

  it('XLSX 날짜 서식 셀을 날짜로 읽고 일반 숫자는 그대로 둔다', () => {
    const text = extractOfficeText(
      'xlsx',
      zip({
        'xl/styles.xml':
          '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy&quot;년&quot; m&quot;월&quot;"/><numFmt numFmtId="165" formatCode="&quot;day&quot;0.00"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>45992</v></c><c r="B1" s="2"><v>45992.5</v></c><c r="C1" s="3"><v>45992</v></c><c r="D1"><v>45992</v></c></row></sheetData></worksheet>',
      })
    );
    expect(text).toContain('2025-12-01\t2025-12-01 12:00\t45992\t45992');
  });

  it('XLSX 자기 닫힌 공유 문자열이 뒤 번호를 밀지 않고 윗주를 빼고 읽는다', () => {
    const text = extractOfficeText(
      'xlsx',
      zip({
        'xl/sharedStrings.xml': '<sst><si/><si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si></sst>',
        'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>',
      })
    );
    expect(text).toContain('東京');
    expect(text).not.toContain('トウキョウ');
  });

  it('HWPX 공백 요소를 공백으로 읽는다', () => {
    const text = extractOfficeText('hwpx', zip({ 'Contents/section0.xml': '<hp:p><hp:t>대한민국<hp:nbSpace/>만세<hp:fwSpace/>끝</hp:t></hp:p>' }));
    expect(text).toBe('대한민국 만세 끝');
  });

  it('DOCX 탭 위치 정의와 대체 콘텐츠를 본문으로 읽지 않는다', () => {
    const text = extractOfficeText(
      'docx',
      zip({
        'word/document.xml':
          '<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>앞</w:t></w:r><mc:AlternateContent><mc:Choice><w:r><w:t>도형글</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>도형글</w:t></w:r></mc:Fallback></mc:AlternateContent><w:r><w:t>뒤</w:t></w:r></w:p></w:body></w:document>',
      })
    );
    expect(text).toBe('앞도형글뒤');
  });

  it('CDATA 본문을 그대로 읽는다', () => {
    const text = extractOfficeText('docx', zip({ 'word/document.xml': '<w:p><w:t><![CDATA[a < b & c]]></w:t></w:p>' }));
    expect(text).toBe('a < b & c');
  });

  it('PPTX 표시 순서는 파일 번호가 아니라 presentation.xml을 따른다', () => {
    const text = extractOfficeText(
      'pptx',
      zip({
        'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>',
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
        'ppt/slides/slide1.xml': '<a:p><a:t>나중</a:t></a:p>',
        'ppt/slides/slide2.xml': '<a:p><a:t>먼저</a:t></a:p>',
      })
    );
    expect(text.indexOf('먼저')).toBeLessThan(text.indexOf('나중'));
  });

  it('시트 관계가 절대 경로여도 찾는다', () => {
    const text = extractOfficeText(
      'xlsx',
      zip({
        'xl/workbook.xml': '<workbook><sheets><sheet name="표" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
      })
    );
    expect(text).toContain('[시트: 표]');
    expect(text).toContain('1');
  });
});
