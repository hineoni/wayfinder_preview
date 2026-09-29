/** Не чаще одного вызова за интервал: пауза до следующего разрешённого момента. */
export class Throttle {
  private nextAt = 0

  constructor(private readonly intervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now()
    const delay = this.nextAt - now
    this.nextAt = Math.max(now, this.nextAt) + this.intervalMs
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
  }
}
