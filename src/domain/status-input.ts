// Grammar of the status line: `[ID] [kw[:]] text`.
import { isStatusKw, type StatusKw } from './model';

export interface StatusCommand {
	id?: string;
	kw?: StatusKw;
	text: string;
}

const ID = /^[A-Za-z]+\d+(\.\d+)*$/;

export function parseStatusInput(input: string, knownIds: string[]): StatusCommand | null {
	let rest = input.trim();
	if (!rest) return null;
	const cmd: StatusCommand = { text: '' };
	const first = rest.split(/\s+/)[0] ?? '';
	if (ID.test(first) && knownIds.includes(first.toUpperCase())) {
		cmd.id = first.toUpperCase();
		rest = rest.slice(first.length).trim();
	}
	const kwTok = (rest.split(/\s+/)[0] ?? '').replace(/:$/, '').toLowerCase();
	if (isStatusKw(kwTok)) {
		cmd.kw = kwTok;
		rest = rest.slice(rest.split(/\s+/)[0]?.length ?? 0).trim();
	}
	cmd.text = rest;
	if (!cmd.kw && !cmd.text) return null;
	return cmd;
}
