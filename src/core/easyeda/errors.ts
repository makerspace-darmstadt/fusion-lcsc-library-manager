export type EasyEdaErrorCode =
  | 'BAD_ID' // input is not an LCSC part number
  | 'HTTP' // transport / non-2xx
  | 'NOT_FOUND' // API answered success:false (component not found)
  | 'INVALID_RESPONSE' // JSON did not have the expected shape
  | 'NOT_IMPORTABLE'; // part exists but has no importable symbol/footprint data

export class EasyEdaError extends Error {
  readonly code: EasyEdaErrorCode;

  constructor(code: EasyEdaErrorCode, message: string) {
    super(message);
    this.name = 'EasyEdaError';
    this.code = code;
  }
}

/** Normalise user input to `C<digits>`; throws BAD_ID otherwise. */
export function normaliseLcscId(input: string): string {
  const id = input.trim().toUpperCase();
  if (!/^C\d{1,10}$/.test(id)) {
    throw new EasyEdaError('BAD_ID', `"${input}" is not an LCSC part number (expected e.g. C3131)`);
  }
  return id;
}
