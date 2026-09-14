export type Severity = 'info' | 'warning' | 'error';

export interface ConversionWarning {
  code: string;
  message: string;
  severity: Severity;
  /** The raw EasyEDA primitive string, when the warning concerns one. */
  raw?: string;
}

export class WarningCollector {
  readonly items: ConversionWarning[] = [];

  add(code: string, message: string, severity: Severity = 'warning', raw?: string): void {
    this.items.push(raw === undefined ? { code, message, severity } : { code, message, severity, raw });
  }

  info(code: string, message: string, raw?: string): void {
    this.add(code, message, 'info', raw);
  }

  warn(code: string, message: string, raw?: string): void {
    this.add(code, message, 'warning', raw);
  }

  error(code: string, message: string, raw?: string): void {
    this.add(code, message, 'error', raw);
  }

  get hasErrors(): boolean {
    return this.items.some((w) => w.severity === 'error');
  }
}
