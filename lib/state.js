/**
 * Persisted collaboration width.
 *
 * The width is a profile-level mode, exactly like the computer-use switch: the
 * user marks "now force N sub-agents" once and every later turn in this profile
 * obeys it until it is changed. That keeps the model-facing tool honest — it has
 * no count parameter, so the only way to change the number is the composer
 * control the user owns.
 *
 * @module dsh-force-collab/state
 */

import { homedir } from 'node:os'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH } from './protocol.js'

/** Directory that holds every small piece of DSH plugin state. */
const STATE_DIR = join(homedir(), '.dsh')

/** The file this plugin owns. */
const STATE_FILE = join(STATE_DIR, 'force-collab.json')

/**
 * Clamp a candidate width into the selectable range.
 * @param {unknown} value - untrusted number-ish value.
 * @returns {number} an integer in `[MIN_WIDTH, MAX_WIDTH]`.
 */
export function clampWidth(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return DEFAULT_WIDTH
	return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.trunc(number)))
}

/**
 * Read the persisted width, falling back to off on a missing or broken file.
 * @param {object} [logger] - host logger.
 * @returns {number} the width to start with.
 */
export function readWidth(logger) {
	try {
		const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
		return clampWidth(parsed?.width)
	} catch (error) {
		const code = /** @type {any} */ (error)?.code
		if (code !== 'ENOENT') logger?.warn?.('force-collab: could not read state: ' + describe(error))
		return DEFAULT_WIDTH
	}
}

/**
 * Persist the width atomically, ignoring filesystem failures.
 * @param {number} width - value to store.
 * @param {object} [logger] - host logger.
 */
export function writeWidth(width, logger) {
	try {
		mkdirSync(STATE_DIR, { recursive: true })
		const tmp = `${STATE_FILE}.tmp`
		writeFileSync(tmp, JSON.stringify({ width: clampWidth(width) }, null, 2), 'utf8')
		renameSync(tmp, STATE_FILE)
	} catch (error) {
		logger?.warn?.('force-collab: could not persist state: ' + describe(error))
	}
}

/**
 * In-memory width with subscribers, so the prompt section and the HTTP route
 * always agree with what the composer control just said.
 */
export class WidthStore {
	/**
	 * @param {object} [logger] - host logger.
	 */
	constructor(logger) {
		/** @type {object | undefined} */
		this.logger = logger
		/** @type {number} */
		this.current = readWidth(logger)
		/** @type {Set<(width: number) => void>} */
		this.listeners = new Set()
	}

	/** @returns {number} the width in force. */
	get width() {
		return this.current
	}

	/** @returns {boolean} whether forcing is on. */
	get enabled() {
		return this.current > MIN_WIDTH
	}

	/**
	 * Change the width.
	 * @param {unknown} value - requested width.
	 * @returns {number} the width now in force.
	 */
	set(value) {
		const width = clampWidth(value)
		if (width === this.current) return this.current
		this.current = width
		writeWidth(width, this.logger)
		this.logger?.info?.(`force-collab: width -> ${width}`)
		for (const listener of this.listeners) {
			try {
				listener(width)
			} catch (error) {
				this.logger?.warn?.('force-collab: width listener failed: ' + describe(error))
			}
		}
		return width
	}

	/**
	 * Observe width changes.
	 * @param {(width: number) => void} listener - called after every change.
	 * @returns {() => void} unsubscribe.
	 */
	subscribe(listener) {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
}

/**
 * Turn anything into a short message.
 * @param {unknown} error - caught value.
 * @returns {string} message text.
 */
function describe(error) {
	return error instanceof Error ? error.message : String(error)
}
