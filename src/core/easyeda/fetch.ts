/**
 * EasyEDA API client. Pure TypeScript: the HTTP function is injected so the same code runs under Node
 * (global fetch) and inside Tauri (`@tauri-apps/plugin-http` fetch).
 */

import { EasyEdaError, normaliseLcscId } from './errors.ts';
import { parseComponent } from './parse.ts';
import type { PartModel } from './types.ts';

export const EASYEDA_VERSION = '6.4.19.5';
export const componentUrl = (lcsc: string): string =>
  `https://easyeda.com/api/products/${lcsc}/components?version=${EASYEDA_VERSION}`;
export const svgsUrl = (lcsc: string): string => `https://easyeda.com/api/products/${lcsc}/svgs`;

/** A full browser-like UA is required: the CDN answers 403 to a bare `Mozilla/5.0`. */
export const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json',
  Referer: 'https://easyeda.com/',
};

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<FetchResponseLike>;

export interface PartSvgs {
  symbol?: string;
  footprint?: string;
}

interface SvgsResponse {
  success?: boolean;
  result?: { docType?: number; svg?: string }[];
}

export class EasyEdaClient {
  private readonly fetchFn: FetchLike;
  private readonly cacheSize: number;
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(fetchFn: FetchLike, cacheSize = 32) {
    this.fetchFn = fetchFn;
    this.cacheSize = cacheSize;
  }

  /** GET + JSON with a small in-memory cache keyed by URL (failed requests are not cached). */
  private async getJson(url: string): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const p = (async () => {
      let res: FetchResponseLike;
      try {
        res = await this.fetchFn(url, { method: 'GET', headers: DEFAULT_HEADERS });
      } catch (e) {
        throw new EasyEdaError('HTTP', `Network error while contacting EasyEDA: ${(e as Error).message}`);
      }
      if (!res.ok) throw new EasyEdaError('HTTP', `EasyEDA answered HTTP ${res.status} for ${url}`);
      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new EasyEdaError('INVALID_RESPONSE', `EasyEDA returned non-JSON content for ${url}`);
      }
    })();
    this.cache.set(url, p);
    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    p.catch(() => this.cache.delete(url));
    return p;
  }

  async fetchComponentJson(lcscInput: string): Promise<unknown> {
    return this.getJson(componentUrl(normaliseLcscId(lcscInput)));
  }

  async fetchPart(lcscInput: string): Promise<PartModel> {
    const id = normaliseLcscId(lcscInput);
    return parseComponent(await this.getJson(componentUrl(id)), id);
  }

  /** SVG previews (docType 2 = symbol, 4 = footprint). UI only, never used for conversion. */
  async fetchSvgs(lcscInput: string): Promise<PartSvgs> {
    const id = normaliseLcscId(lcscInput);
    const json = (await this.getJson(svgsUrl(id))) as SvgsResponse;
    const out: PartSvgs = {};
    if (!json?.success || !Array.isArray(json.result)) return out;
    for (const r of json.result) {
      if (r.docType === 2 && r.svg) out.symbol = r.svg;
      else if (r.docType === 4 && r.svg) out.footprint = r.svg;
    }
    return out;
  }
}
