/**
 * One Euro 필터 — 느리게 움직일 때는 떨림을 강하게 줄이고, 빠르게 움직일 때는 지연을 줄인다.
 * Casiez et al. 2012. 값의 단위가 픽셀이면 beta는 0.01 안팎이 적당하다.
 */
export class OneEuroFilter {
  private previous: number | null = null;
  private previousDerivative = 0;
  private previousTime = 0;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.012,
    private readonly derivativeCutoff = 1
  ) {}

  private alpha(cutoff: number, dtSeconds: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dtSeconds);
  }

  filter(value: number, timeMs: number): number {
    if (this.previous === null) {
      this.previous = value;
      this.previousTime = timeMs;
      return value;
    }
    const dt = (timeMs - this.previousTime) / 1000;
    if (dt <= 0) return this.previous;

    const derivative = (value - this.previous) / dt;
    const dAlpha = this.alpha(this.derivativeCutoff, dt);
    const smoothedDerivative = dAlpha * derivative + (1 - dAlpha) * this.previousDerivative;

    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDerivative);
    const a = this.alpha(cutoff, dt);
    const smoothed = a * value + (1 - a) * this.previous;

    this.previous = smoothed;
    this.previousDerivative = smoothedDerivative;
    this.previousTime = timeMs;
    return smoothed;
  }

  reset() {
    this.previous = null;
    this.previousDerivative = 0;
    this.previousTime = 0;
  }
}
