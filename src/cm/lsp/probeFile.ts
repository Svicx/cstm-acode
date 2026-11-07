type NativeSystemApi = {
	getFilesDir: (
		success: (path: string) => void,
		error: (reason: unknown) => void,
	) => void;
	mkdirs?: (
		path: string,
		success: () => void,
		error: (reason: unknown) => void,
	) => void;
	writeText: (
		path: string,
		content: string,
		success: () => void,
		error: (reason: unknown) => void,
	) => void;
};

const MAX_ENTRIES = 300;
const MAX_RECORD_CHARS = 8000;
const entries: string[] = [];
let pathPromise: Promise<string> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function getSystemApi(): NativeSystemApi {
	const root = globalThis as typeof globalThis & {
		system?: NativeSystemApi;
		window?: { system?: NativeSystemApi };
	};
	const api = root.system ?? root.window?.system;
	if (!api?.getFilesDir || !api.writeText) {
		throw new Error("Acode native system file API is not available");
	}
	return api;
}

function getLogPath(): Promise<string> {
	if (!pathPromise) {
		pathPromise = (async () => {
			const system = getSystemApi();
			const filesDir = await new Promise<string>((resolve, reject) => {
				system.getFilesDir(resolve, reject);
			});
			const publicDir = `${String(filesDir).replace(/\/+$/, "")}/public`;
			if (system.mkdirs) {
				await new Promise<void>((resolve, reject) => {
					system.mkdirs?.(publicDir, resolve, reject);
				});
			}
			return `${publicDir}/rust-lsp-probe.log`;
		})();
	}
	return pathPromise.catch((error) => {
		pathPromise = null;
		throw error;
	});
}

function serializeDetails(details: unknown): string {
	try {
		const serialized = JSON.stringify(details, (_key, value) => {
			if (value instanceof Error) {
				return {
					name: value.name,
					message: value.message,
					stack: value.stack,
				};
			}
			return value;
		});
		return String(serialized ?? details).slice(0, MAX_RECORD_CHARS);
	} catch {
		return String(details).slice(0, MAX_RECORD_CHARS);
	}
}

/** Writes diagnostic events to the directory exposed as /public in Acode Terminal. */
export function logRustCompletionProbe(
	event: string,
	details?: unknown,
): void {
	const suffix = details === undefined ? "" : ` ${serializeDetails(details)}`;
	const line = `${new Date().toISOString()} [RUST-LSP-PROBE] ${event}${suffix}`;
	entries.push(line);
	if (entries.length > MAX_ENTRIES) {
		entries.splice(0, entries.length - MAX_ENTRIES);
	}
	console.info(line);

	const snapshot = `${entries.join("\n")}\n`;
	writeQueue = writeQueue
		.then(async () => {
			const path = await getLogPath();
			const system = getSystemApi();
			await new Promise<void>((resolve, reject) => {
				system.writeText(path, snapshot, resolve, reject);
			});
		})
		.catch((error) => {
			console.error("[RUST-LSP-PROBE] unable to write diagnostic file", error);
		});
}
