import type { IsoDate } from './model';

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

export function toIsoDate(v: unknown): IsoDate | undefined {
	if (typeof v === 'string') {
		const m = ISO.exec(v.trim());
		return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
	}
	if (typeof v === 'number' && Number.isFinite(v)) return fromEpoch(v);
	return undefined;
}

export function fromEpoch(ms: number): IsoDate {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dayNumber(d: IsoDate): number {
	const m = ISO.exec(d);
	if (!m) return NaN;
	return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
	return dayNumber(to) - dayNumber(from);
}

export function addDays(d: IsoDate, n: number): IsoDate {
	const x = new Date((dayNumber(d) + n) * 86_400_000);
	const p = (v: number) => String(v).padStart(2, '0');
	return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}
