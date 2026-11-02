/** 승인 미리보기용 줄 단위 비교. 나란히 보여줄 행을 만든다. */
export interface DiffCell {
  /** 원본에서의 줄 번호 (1부터) */
  line: number;
  text: string;
  changed: boolean;
}

export interface DiffRow {
  left: DiffCell | null;
  right: DiffCell | null;
}

/** 이보다 길면 LCS 계산을 포기하고 줄 위치로 맞춰 비교한다. 승인 카드가 멈추면 안 된다. */
const MAX_LCS_LINES = 1500;

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

function positional(a: string[], b: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  const total = Math.max(a.length, b.length);
  for (let i = 0; i < total; i++) {
    const hasA = i < a.length;
    const hasB = i < b.length;
    const same = hasA && hasB && a[i] === b[i];
    rows.push({
      left: hasA ? { line: i + 1, text: a[i], changed: !same } : null,
      right: hasB ? { line: i + 1, text: b[i], changed: !same } : null,
    });
  }
  return rows;
}

export function lineDiff(before: string, after: string): DiffRow[] {
  const a = splitLines(before);
  const b = splitLines(after);

  // 앞뒤 공통 부분을 먼저 걷어 내 비교 크기를 줄인다.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) {
    rows.push({ left: { line: i + 1, text: a[i], changed: false }, right: { line: i + 1, text: b[i], changed: false } });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length > MAX_LCS_LINES || midB.length > MAX_LCS_LINES) {
    for (const row of positional(midA, midB)) {
      rows.push({
        left: row.left && { ...row.left, line: row.left.line + start },
        right: row.right && { ...row.right, line: row.right.line + start },
      });
    }
  } else {
    // 최장 공통 부분수열로 추가와 삭제를 찾는다.
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    let pendingLeft: DiffCell[] = [];
    let pendingRight: DiffCell[] = [];
    const flush = () => {
      // 삭제와 추가가 이어지면 같은 행에 나란히 놓아 무엇이 바뀌었는지 보이게 한다.
      const total = Math.max(pendingLeft.length, pendingRight.length);
      for (let k = 0; k < total; k++) {
        rows.push({ left: pendingLeft[k] ?? null, right: pendingRight[k] ?? null });
      }
      pendingLeft = [];
      pendingRight = [];
    };

    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        flush();
        rows.push({
          left: { line: start + i + 1, text: midA[i], changed: false },
          right: { line: start + j + 1, text: midB[j], changed: false },
        });
        i++;
        j++;
      } else if (j < m && (i >= n || table[i][j + 1] >= table[i + 1][j])) {
        pendingRight.push({ line: start + j + 1, text: midB[j], changed: true });
        j++;
      } else {
        pendingLeft.push({ line: start + i + 1, text: midA[i], changed: true });
        i++;
      }
    }
    flush();
  }

  for (let k = 0; k < a.length - endA; k++) {
    rows.push({
      left: { line: endA + k + 1, text: a[endA + k], changed: false },
      right: { line: endB + k + 1, text: b[endB + k], changed: false },
    });
  }
  return rows;
}

/** 바뀐 줄 근처만 남기고 긴 동일 구간을 접는다. null은 접힌 구간을 뜻한다. */
export function collapseUnchanged(rows: DiffRow[], context = 3): Array<DiffRow | null> {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.left?.changed || row.right?.changed || !row.left || !row.right) {
      for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
    }
  });
  if (!keep.some(Boolean)) return rows.length > context * 2 ? [...rows.slice(0, context), null] : rows;
  const out: Array<DiffRow | null> = [];
  rows.forEach((row, i) => {
    if (keep[i]) out.push(row);
    else if (out[out.length - 1] !== null) out.push(null);
  });
  return out;
}
