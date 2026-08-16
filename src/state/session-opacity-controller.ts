export const OPACITY_MIN = 0.02;
export const OPACITY_MAX = 0.35;
export const OPACITY_STEP = 0.02;

export class SessionOpacityController {
  private override: number | undefined;

  effective(configured: number): number {
    return clamp(this.override ?? configured);
  }

  increase(configured: number): number {
    return this.adjust(configured, OPACITY_STEP);
  }

  decrease(configured: number): number {
    return this.adjust(configured, -OPACITY_STEP);
  }

  reset(): void {
    this.override = undefined;
  }

  private adjust(configured: number, amount: number): number {
    this.override = round(clamp(this.effective(configured) + amount));
    return this.override;
  }
}

function clamp(value: number): number {
  const safe = Number.isFinite(value) ? value : 0.08;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, safe));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
