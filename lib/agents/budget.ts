import { BudgetExceededError, CancelledError } from './errors';

/** 남은 예산이 이 비율 아래로 내려가면 모델 호출을 한 번에 하나씩만 보낸다. */
const LOW_BUDGET_RATIO = 0.25;
/**
 * 진행 중인 호출을 끊는 선. 상한을 조금 넘는 호출까지 끊으면 거의 끝난 답변을 버리게 되어
 * 이미 쓴 비용이 낭비된다. 새 호출은 상한에서 바로 막는다.
 */
const CUT_IN_FLIGHT_RATIO = 1.1;

export interface CallTicket {
  /** 이 호출을 끊는 신호. 미션 취소와 예산 초과를 모두 포함한다. */
  signal: AbortSignal;
  /** 이 호출이 출력에 쓸 수 있는 금액. max_tokens를 여기에 맞춘다. */
  maxOutputUsd: number;
  /** 진행 중인 호출의 지금까지 추정 비용 */
  update: (estimatedUsd: number) => void;
  /** 예산 초과로 끊겼으면 그 오류 */
  budgetError: () => BudgetExceededError | null;
  /** 호출이 끝나면 부른다. 실제 비용을 기록한 뒤에 불러야 이중 계산이 생기지 않는다. */
  release: () => void;
}

/**
 * 한 턴의 비용 상한. 호출 시작 전 검사만으로는 병렬 호출이 상한을 몇 배나 넘길 수 있어 세 겹으로 막는다.
 * 1) 남은 예산을 동시 호출 수로 나눠 각 호출의 max_tokens를 줄인다. API가 지키는 유일한 하드 리밋이다.
 * 2) 진행 중인 호출의 추정 비용까지 더해 110%를 넘으면 진행 중인 호출을 끊는다.
 * 3) 남은 예산이 25% 미만이면 호출을 한 번에 하나씩 보낸다.
 *
 * 한계: 입력 비용은 message_start에 가서야 알기 때문에 동시에 시작한 호출들의 입력은 막지 못한다.
 * 출력은 받은 글자 수로 추정하는데 요약된 추론은 실제 추론보다 짧아 낮게 잡힐 수 있고, 끊은 호출도
 * 그때까지 생성한 토큰은 청구된다. 그래서 실제 비용은 상한의 110%를 넘을 수 있다.
 * 최악의 경우는 대략 상한 + 동시에 시작한 호출들의 입력 비용이다.
 */
export class BudgetGuard {
  private readonly inFlight = new Set<{ usd: number }>();
  private readonly overrun = new AbortController();
  private releaseWaiters: (() => void)[] = [];

  constructor(
    private readonly limitUsd: number,
    /** 이번 턴에 확정된 비용 */
    private readonly spentUsd: () => number
  ) {}

  private estimatedInFlight(): number {
    let sum = 0;
    for (const call of this.inFlight) sum += call.usd;
    return sum;
  }

  private check() {
    if (this.overrun.signal.aborted || this.spentUsd() >= this.limitUsd) {
      throw new BudgetExceededError(this.limitUsd);
    }
  }

  private remainingUsd(): number {
    return this.limitUsd - this.spentUsd() - this.estimatedInFlight();
  }

  private isLow(): boolean {
    return this.remainingUsd() < this.limitUsd * LOW_BUDGET_RATIO;
  }

  private evaluate() {
    if (!this.overrun.signal.aborted && this.spentUsd() + this.estimatedInFlight() >= this.limitUsd * CUT_IN_FLIGHT_RATIO) {
      this.overrun.abort();
    }
  }

  private nextRelease(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new CancelledError());
        return;
      }
      const onAbort = () => reject(new CancelledError());
      signal.addEventListener('abort', onAbort, { once: true });
      this.releaseWaiters.push(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  /**
   * 모델 호출 직전에 부른다. 예산을 넘었으면 throw 하고, 얼마 남지 않았으면 앞선 호출이 끝나길 기다린다.
   * parallelism은 이 호출과 동시에 달릴 수 있는 호출 수다.
   */
  async acquire(signal: AbortSignal, parallelism = 1): Promise<CallTicket> {
    this.check();
    while (this.inFlight.size > 0 && this.isLow()) {
      await this.nextRelease(signal);
      this.check();
    }
    const remaining = Math.max(0, this.remainingUsd());
    const call = { usd: 0 };
    this.inFlight.add(call);
    return {
      signal: AbortSignal.any([signal, this.overrun.signal]),
      // 예산이 적으면 한 번에 하나씩 가므로 나눌 필요가 없다.
      maxOutputUsd: this.isLow() ? remaining : remaining / Math.max(1, parallelism),
      update: (usd) => {
        call.usd = usd;
        this.evaluate();
      },
      budgetError: () => (this.overrun.signal.aborted ? new BudgetExceededError(this.limitUsd) : null),
      release: () => {
        this.inFlight.delete(call);
        this.evaluate();
        const waiters = this.releaseWaiters;
        this.releaseWaiters = [];
        for (const wake of waiters) wake();
      },
    };
  }
}
