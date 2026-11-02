import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  dueLabel,
  fromIso,
  parseKoreanDue,
  startOfWeek,
  toIso,
  weekOf,
} from '@/components/planner/dates';

// 2026-11-02는 월요일
const MON = '2026-11-02';
const FRI = '2026-11-06';

describe('날짜 헬퍼', () => {
  it('현지 날짜를 ISO로 왕복한다', () => {
    expect(toIso(fromIso(MON))).toBe(MON);
    expect(toIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('월·연 경계를 넘긴다', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
  });

  it('달을 옮길 때 없는 날은 말일로 맞춘다', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('주는 월요일에 시작한다', () => {
    expect(startOfWeek(MON)).toBe(MON);
    expect(startOfWeek('2026-11-08')).toBe(MON); // 일요일
    expect(weekOf('2026-11-05')).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08',
    ]);
  });
});

describe('dueLabel', () => {
  it('지금 기준의 말로 바꾼다', () => {
    expect(dueLabel(MON, MON)).toEqual({ text: '오늘', tone: 'today' });
    expect(dueLabel('2026-11-03', MON).text).toBe('내일');
    expect(dueLabel('2026-11-04', MON).text).toBe('모레');
    expect(dueLabel('2026-11-06', MON).text).toBe('금요일');
    expect(dueLabel('2026-11-01', MON)).toEqual({ text: '어제까지', tone: 'overdue' });
    expect(dueLabel('2026-10-30', MON)).toEqual({ text: '3일 지남', tone: 'overdue' });
    expect(dueLabel('2026-12-25', MON).text).toBe('12월 25일');
    expect(dueLabel('2027-01-03', MON).text).toBe('2027년 1월 3일');
  });
});

describe('parseKoreanDue', () => {
  const cases: Array<[string, string, string, string]> = [
    // 입력, 오늘, 기대 기한, 기대 본문
    ['오늘 회의록 정리', MON, MON, '회의록 정리'],
    ['내일 보고서 제출', MON, '2026-11-03', '보고서 제출'],
    ['내일까지 보고서 제출', MON, '2026-11-03', '보고서 제출'],
    ['보고서 내일까지 제출', MON, '2026-11-03', '보고서 제출'],
    ['보고서 제출 내일', MON, '2026-11-03', '보고서 제출'],
    ['모레 치과 예약', MON, '2026-11-04', '치과 예약'],
    ['내일모레 치과 예약', MON, '2026-11-04', '치과 예약'],
    ['글피 약속 잡기', MON, '2026-11-05', '약속 잡기'],
    ['금요일 세금 계산서 발행', MON, FRI, '세금 계산서 발행'],
    ['금요일까지 세금 계산서 발행', MON, FRI, '세금 계산서 발행'],
    ['금욜에 세금 계산서 발행', MON, FRI, '세금 계산서 발행'],
    ['이번 주 금요일 발표 준비', MON, FRI, '발표 준비'],
    ['이번주 금요일 발표 준비', MON, FRI, '발표 준비'],
    ['다음 주 월요일 킥오프', MON, '2026-11-09', '킥오프'],
    ['담주 수요일 킥오프', MON, '2026-11-11', '킥오프'],
    ['12/3 계약서 검토', MON, '2026-12-03', '계약서 검토'],
    ['계약서 검토 12/3까지', MON, '2026-12-03', '계약서 검토'],
    ['12월 3일 계약서 검토', MON, '2026-12-03', '계약서 검토'],
    ['12월3일 계약서 검토', MON, '2026-12-03', '계약서 검토'],
    ['2027-02-14 발렌타인 준비', MON, '2027-02-14', '발렌타인 준비'],
    ['2027.2.14 발렌타인 준비', MON, '2027-02-14', '발렌타인 준비'],
    ['15일까지 정산', MON, '2026-11-15', '정산'],
    ['3일 뒤 답장', MON, '2026-11-05', '답장'],
    ['일주일 후 다시 확인', MON, '2026-11-09', '다시 확인'],
  ];

  it.each(cases)('%s', (input, today, due, text) => {
    const parsed = parseKoreanDue(input, today);
    expect(parsed.due).toBe(due);
    expect(parsed.text).toBe(text);
    expect(parsed.matched).toBeTruthy();
  });

  it('오늘이 그 요일이면 다음 주로 읽는다', () => {
    expect(parseKoreanDue('금요일 발표', FRI).due).toBe('2026-11-13');
  });

  it('지나간 월일은 내년으로 읽는다', () => {
    expect(parseKoreanDue('3/1 개강 준비', MON).due).toBe('2027-03-01');
    expect(parseKoreanDue('10월 1일 결산', MON).due).toBe('2027-10-01');
  });

  it('이번 달에 지난 날짜만 말하면 다음 달로 읽는다', () => {
    expect(parseKoreanDue('1일까지 정산', MON).due).toBe('2026-12-01');
    expect(parseKoreanDue('2일까지 정산', MON).due).toBe(MON);
  });

  it('없는 날짜는 기한으로 읽지 않는다', () => {
    expect(parseKoreanDue('2/30 정리', MON).due).toBeUndefined();
    expect(parseKoreanDue('13/40 정리', MON).due).toBeUndefined();
  });

  it('다른 말의 일부는 기한으로 읽지 않는다', () => {
    const notDue = [
      '오늘의 회고 작성',
      '내일로 미루기 금지 포스터',
      '3일 동안 테스트',
      '3일간 출장 보고',
      'v1.2 배포',
      '3.5버전 출시',
      '월요병 극복 글 쓰기',
      '화요일에-회의', // 뒤에 곧바로 다른 글자가 붙으면 읽지 않는다
      '일요일기 쓰기',
    ];
    for (const input of notDue) {
      expect(parseKoreanDue(input, MON).due, input).toBeUndefined();
      expect(parseKoreanDue(input, MON).text).toBe(input);
    }
  });

  it('기한만 적으면 내용으로 남긴다', () => {
    expect(parseKoreanDue('내일', MON)).toEqual({ text: '내일' });
    expect(parseKoreanDue('  금요일까지 ', MON)).toEqual({ text: '금요일까지' });
  });

  it('가장 앞의 표현 하나만 쓴다', () => {
    const parsed = parseKoreanDue('내일 금요일 발표 자료 확인', MON);
    expect(parsed.due).toBe('2026-11-03');
    expect(parsed.text).toBe('금요일 발표 자료 확인');
  });

  it('까지가 붙은 표현을 기한으로 먼저 본다', () => {
    const parsed = parseKoreanDue('내일 회의 자료 금요일까지', MON);
    expect(parsed.due).toBe(FRI);
    expect(parsed.text).toBe('내일 회의 자료');
    expect(parseKoreanDue('오늘 화면 정리 오늘까지', MON)).toMatchObject({ due: MON, text: '오늘 화면 정리' });
  });

  it('앞뒤 공백과 중복 공백을 정리한다', () => {
    expect(parseKoreanDue('  회의록   내일   정리 ', MON).text).toBe('회의록 정리');
    expect(parseKoreanDue('그냥 할 일', MON)).toEqual({ text: '그냥 할 일' });
  });
});
