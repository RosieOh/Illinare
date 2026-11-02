import { BudgetExceededError, CancelledError } from './errors';

/** 남은 예산이 이 비율 아래로 내려가면 모델 호출을 한 번에 하나씩만 보낸다. */
const LOW_BUDGET_RATIO = 0.25;
/** 출력 예약은 상한의 이만큼을 넘지 않는다. 작은 상한에서 첫 호출조차 시작하지 못하는 일을 막는다. */
const MAX_ALLOWANCE_RATIO = 0.25;

export interface CallEstimate {
  /** 호출 전에 추정한 입력 비용 */
  inputUsd: number;
  /** 출력에 예약할 금액. max_tokens 전체가 아니라 작은 몫이다. */
  outputAllowanceUsd: number;
}

export interface CallTicket {
  /** 이 호출을 끊는 신호. 미션 취소와 예산 초과를 모두 포함한다. */
  signal: AbortSignal;
  /** 이 호출이 출력에 쓸 수 있는 금액. max_tokens를 여기에 맞춘다. */
  maxOutputUsd: number;
  /** 진행 중인 호출의 지금까지 추정 비용 */
  update: (estimatedUsd: number) => void;
  /** 예산 초과로 끊겼으면 그 오류 */
  budgetError: () => BudgetExceededError | null;
  /** 호출이 끝나면 부른다. 실제 비용을 기록한 뒤에 불러야 이중 계산이 생기지 않는다. 이때 예약이 정산된다. */
  release: () => void;
}

export interface AcquireOptions {
  /** 이 호출과 동시에 달릴 수 있는 호출 수 */
  parallelism?: number;
  estimate?: CallEstimate;
}

interface InFlightCall {
  reservedUsd: number;
  liveUsd: number;
}

/**
 * 한 턴의 비용 상한. 입력 비용은 응답이 시작되어야 알 수 있어 호출 시작 전 검사만으로는
 * 병렬 호출이 상한을 몇 배나 넘길 수 있다. 그래서 네 겹으로 막는다.
 * 1) 호출 전에 입력 추정치와 작은 출력 몫을 예약한다. 확정 비용 + 미정산 예약이 상한을 넘으면 앞선 호출이
 *    끝나길 기다렸다가 다시 보고, 혼자인데도 넘으면 시작하지 않는다. max_tokens 전체를 예약하면
 *    Opus 호출 몇 개만으로 $2 미션이 시작조차 못 한다.
 * 2) 남은 예산을 동시 호출 수로 나눠 각 호출의 max_tokens를 줄인다. API가 지키는 유일한 하드 리밋이다.
 * 3) 진행 중인 호출의 실제 사용량 추정치까지 더해 상한을 넘으면 진행 중인 호출을 끊는다.
 * 4) 남은 예산이 25% 미만이면 호출을 한 번에 하나씩 보낸다.
 *
 * 한계: 입력 예약은 글자 수로 잡은 추정치다. 실제 입력이 더 크면 시작한 뒤에야 message_start로 드러나고,
 * 웹 도구 결과는 한 호출 안에서 입력으로 더 쌓이는데 호출이 끝나야 그 값을 안다. 출력은 받은 글자 수로
 * 추정하는데 요약된 추론은 실제 추론보다 짧아 낮게 잡힐 수 있고, 끊은 호출도 그때까지 생성한 토큰은 청구된다.
 * 그래서 상한은 여전히 근사치다. 최악의 경우는 대략 다음의 합이다.
 *   상한 + 동시 호출들의 입력 추정 오차 + 끊기 전까지 보이지 않은 출력 + 리서처의 웹 도구 입력
 *   + 상한이 작아 예약이 줄었을 때 호출당 최소 출력(max_tokens 하한)에서 예약하지 못한 몫
 */
export class BudgetGuard {
  private readonly inFlight = new Set<InFlightCall>();
  private readonly overrun = new AbortController();
  private releaseWaiters: (() => void)[] = [];

  constructor(
    private readonly limitUsd: number,
    /** 이번 턴에 확정된 비용 */
    private readonly spentUsd: () => number
  ) {}

  /** 아직 정산되지 않은 몫. 실제 사용량이 예약을 넘은 호출은 실제 사용량으로 친다. */
  private outstandingUsd(): number {
    let sum = 0;
    for (const call of this.inFlight) sum += Math.max(call.reservedUsd, call.liveUsd);
    return sum;
  }

  private liveUsd(): number {
    let sum = 0;
    for (const call of this.inFlight) sum += call.liveUsd;
    return sum;
  }

  private check() {
    if (this.overrun.signal.aborted || this.spentUsd() >= this.limitUsd) {
      throw new BudgetExceededError(this.limitUsd);
    }
  }

  private remainingUsd(): number {
    return this.limitUsd - this.spentUsd() - this.outstandingUsd();
  }

  private fits(reservedUsd: number): boolean {
    return reservedUsd <= this.remainingUsd();
  }

  private isLow(): boolean {
    return this.remainingUsd() < this.limitUsd * LOW_BUDGET_RATIO;
  }

  /** 끊는 기준은 예약이 아니라 실제 사용량이다. 예약은 아직 쓴 돈이 아니므로 그것으로 호출을 끊지 않는다. */
  private evaluate() {
    if (!this.overrun.signal.aborted && this.spentUsd() + this.liveUsd() > this.limitUsd) {
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
   * 모델 호출 직전에 부른다. 예산을 넘었으면 throw 하고, 예약이 들어갈 자리가 없거나 얼마 남지 않았으면
   * 앞선 호출이 끝나길 기다린다. 앞선 호출의 실제 비용이 예약보다 적으면 그 차이만큼 자리가 생긴다.
   */
  async acquire(signal: AbortSignal, options: AcquireOptions = {}): Promise<CallTicket> {
    const inputUsd = options.estimate?.inputUsd ?? 0;
    const allowanceUsd = Math.min(options.estimate?.outputAllowanceUsd ?? 0, this.limitUsd * MAX_ALLOWANCE_RATIO);
    const reservedUsd = inputUsd + allowanceUsd;

    this.check();
    while (this.inFlight.size > 0 && (this.isLow() || !this.fits(reservedUsd))) {
      await this.nextRelease(signal);
      this.check();
    }
    if (!this.fits(reservedUsd)) throw new BudgetExceededError(this.limitUsd);

    const remaining = Math.max(0, this.remainingUsd() - inputUsd);
    const alone = this.inFlight.size === 0;
    const call: InFlightCall = { reservedUsd, liveUsd: 0 };
    this.inFlight.add(call);
    return {
      signal: AbortSignal.any([signal, this.overrun.signal]),
      // 예산이 적으면 뒤따르는 호출이 기다리므로 나눌 필요가 없다.
      maxOutputUsd: alone && this.isLow() ? remaining : remaining / Math.max(1, options.parallelism ?? 1),
      update: (usd) => {
        call.liveUsd = usd;
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
