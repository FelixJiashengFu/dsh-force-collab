/**
 * Host half of the forced-collaboration plugin.
 *
 * The plugin contributes three things, all keyed on one profile-level number —
 * the "collaboration width" the user picks in the composer (0 = off, 1..6 =
 * exactly that many sub-agents):
 *
 * 1. `collab_fanout`, a model-facing tool that spawns exactly `width` children
 *    in the calling session and returns all of their reports. It has no count
 *    parameter, so the model cannot pick its own number.
 * 2. A dynamic system-prompt section that makes delegating the default for any
 *    task that needs hands, and points at that one tool.
 * 3. A loopback-only HTTP route that the composer control reads and writes.
 *
 * @module dsh-force-collab
 */

import { MAX_WIDTH, MIN_WIDTH, ROUTE_STATE } from './protocol.js'
import { mountPrompt } from './prompt.js'
import { WidthStore } from './state.js'
import { mountTools } from './tools.js'

/** Plugin name used by the bundle patch and by logs. */
export const name = 'force-collab'

/** Host services this plugin needs before it can mount anything. */
export const inject = ['tools', 'webServer', 'systemPrompt']

/** Largest accepted request body for the state route. */
const MAX_BODY = 4 * 1024

/**
 * Session-id bookkeeping for sessions this plugin spawned.
 *
 * Two uses: a child is refused by `collab_fanout` (one level of fan-out, never
 * recursive), and the prompt section stays out of child sessions.
 */
export class ChildLedger {
	constructor() {
		/** @type {Set<string>} */
		this.children = new Set()
		/** @type {Map<string, number>} */
		this.byParent = new Map()
	}

	/**
	 * @param {string} sessionId - candidate child session id.
	 * @returns {boolean} whether this plugin spawned that session.
	 */
	has(sessionId) {
		return this.children.has(sessionId)
	}

	/**
	 * Remember one spawned child.
	 * @param {string} childId - child session id.
	 * @param {string} parentId - parent session id.
	 * @returns {void}
	 */
	add(childId, parentId) {
		if (typeof childId !== 'string' || childId === '') return
		this.children.add(childId)
		if (typeof parentId === 'string' && parentId !== '') {
			this.byParent.set(parentId, (this.byParent.get(parentId) ?? 0) + 1)
		}
	}

	/**
	 * @param {string} parentId - parent session id.
	 * @returns {number} how many children that parent has already spawned.
	 */
	count(parentId) {
		return this.byParent.get(parentId) ?? 0
	}

	/** Drop every record; children of a reloaded plugin are simply forgotten. */
	clear() {
		this.children.clear()
		this.byParent.clear()
	}
}

/**
 * Plugin entry point.
 * @param {object} ctx - host context with `tools`, `webServer`, `systemPrompt`.
 */
export function apply(ctx) {
	const logger = ctx.logger
	const store = new WidthStore(logger)
	const ledger = new ChildLedger()

	logger?.info?.(`force-collab: loaded, width ${store.width}`)

	ctx.effect(() => {
		const dispose = mountPrompt(ctx, { store, ledger, logger })
		return () => {
			try {
				dispose()
			} catch {
				/* already gone */
			}
		}
	}, 'force-collab prompt section')

	ctx.effect(() => {
		const disposers = mountTools(ctx, { store, ledger, logger })
		return () => {
			for (const dispose of disposers) {
				try {
					dispose()
				} catch {
					/* already gone */
				}
			}
		}
	}, 'force-collab tool')

	ctx.inject(['webServer'], (webCtx) => {
		webCtx.effect(() => webCtx.webServer.register({
			kind: 'exact',
			path: ROUTE_STATE,
			async handler(req, res) {
				if (!isLoopback(req)) {
					sendJson(res, 403, { ok: false, error: 'loopback only' })
					return
				}
				try {
					if (req.method === 'GET') {
						sendJson(res, 200, snapshot(store))
						return
					}
					if (req.method !== 'POST') {
						sendJson(res, 405, { ok: false, error: 'method not allowed' })
						return
					}
					const body = await readJson(req)
					const width = body?.width
					if (typeof width !== 'number' || !Number.isInteger(width) || width < MIN_WIDTH || width > MAX_WIDTH) {
						sendJson(res, 400, { ok: false, error: `width must be an integer in [${MIN_WIDTH}, ${MAX_WIDTH}]` })
						return
					}
					store.set(width)
					sendJson(res, 200, snapshot(store))
				} catch (error) {
					sendJson(res, 500, { ok: false, error: describe(error), width: store.width })
				}
			}
		}), 'force-collab state route')
	})

	ctx.effect(() => () => {
		ledger.clear()
	}, 'force-collab ledger')
}

/**
 * The public view of the width, shared with the composer control.
 * @param {WidthStore} store - width store.
 * @returns {object} JSON payload.
 */
function snapshot(store) {
	return {
		ok: true,
		width: store.width,
		enabled: store.enabled,
		min: MIN_WIDTH,
		max: MAX_WIDTH
	}
}

/**
 * Write one JSON response.
 * @param {object} res - node response.
 * @param {number} status - HTTP status.
 * @param {object} body - payload.
 */
function sendJson(res, status, body) {
	const payload = JSON.stringify(body)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(payload)
	})
	res.end(payload)
}

/**
 * Read and decode a small JSON request body.
 * @param {object} req - node request.
 * @returns {Promise<object>} decoded body.
 */
async function readJson(req) {
	const chunks = []
	let size = 0
	for await (const chunk of req) {
		size += chunk.length
		if (size > MAX_BODY) throw new Error('request body too large')
		chunks.push(chunk)
	}
	if (size === 0) return {}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * @param {object} req - node request.
 * @returns {boolean} whether the request came from this machine.
 */
function isLoopback(req) {
	const address = req.socket?.remoteAddress ?? ''
	return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Turn a caught value into a short message.
 * @param {unknown} error - caught value.
 * @returns {string} message text.
 */
function describe(error) {
	return error instanceof Error ? error.message : String(error)
}
