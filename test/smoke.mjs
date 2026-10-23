/**
 * Smoke test for the forced-collaboration plugin.
 *
 * There is no DSH host in a plain Node process, so every host service is faked
 * with the smallest object that still exercises the real code paths:
 *
 * - `index.js#apply` must mount one tool, one prompt section and one HTTP route;
 * - the prompt section must be empty when off and empty inside a child session;
 * - `collab_fanout` must spawn exactly `width` children and aggregate them;
 * - the route must read and write the width, and reject out-of-range values;
 * - `client.js` must load through `window.__ModuleLoader__` and seat itself.
 *
 * Run with: node test/smoke.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Keep the test away from the real `~/.dsh/force-collab.json`: `state.js` ends
// up holding a real file path, so point the home directory elsewhere first.
process.env.USERPROFILE = join(tmpdir(), 'dsh-force-collab-test')
process.env.HOME = process.env.USERPROFILE

const { apply } = await import('../lib/index.js')
const { MAX_WIDTH, MIN_WIDTH, ROUTE_STATE, TOOL_NAME } = await import('../lib/protocol.js')

/** Silent logger: the plugin must never need a real one. */
const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

/**
 * Build a fake host context that records what the plugin registers.
 * @param {object} services - named services available through `ctx.get`.
 * @returns {object} `{ ctx, registered }`.
 */
function makeHost(services) {
	const registered = { tools: [], sections: [], routes: [] }

	/**
	 * Run one effect callback immediately.
	 * @param {Function} fn - effect body.
	 * @returns {() => void} disposer.
	 */
	function effect(fn) {
		const dispose = fn()
		return () => {
			if (typeof dispose === 'function') dispose()
		}
	}

	const ctx = {
		logger,
		effect,
		inject: (_deps, callback) => callback(ctx),
		get: (name) => services[name],
		systemPrompt: {
			getSectionOrder: (name) => {
				if (name !== 'TOOL_SUBAGENT') throw new Error(`unknown section ${name}`)
				return 700
			},
			getContextOrder: () => 700,
			section: (definition) => {
				registered.sections.push(definition)
				return () => {}
			},
			context: () => () => {}
		},
		tools: {
			register: (definition) => {
				registered.tools.push(definition)
				return () => {}
			},
			get: (name) => registered.tools.find((tool) => tool.name === name)
		},
		webServer: {
			register: (route) => {
				registered.routes.push(route)
				return () => {}
			}
		}
	}
	return { ctx, registered }
}

/**
 * Invoke the plugin's HTTP route with a fake node request/response pair.
 * @param {object} route - registered route.
 * @param {string} method - HTTP method.
 * @param {object} [body] - JSON body.
 * @param {string} [address] - peer address.
 * @returns {Promise<{status: number, body: object}>} captured response.
 */
async function callRoute(route, method, body, address = '127.0.0.1') {
	const payload = body === undefined ? '' : JSON.stringify(body)
	const req = {
		method,
		socket: { remoteAddress: address },
		async *[Symbol.asyncIterator]() {
			if (payload !== '') yield Buffer.from(payload, 'utf8')
		}
	}
	let status = 0
	let raw = ''
	const res = {
		writeHead: (code) => {
			status = code
		},
		end: (chunk) => {
			raw = chunk ?? ''
		}
	}
	await route.handler(req, res)
	return { status, body: raw === '' ? {} : JSON.parse(raw) }
}

/**
 * Boot the plugin against fake services, then normalise the persisted width to
 * off so tests never inherit a value another test wrote.
 * @param {object} subagents - subagent service.
 * @returns {Promise<object>} host plus `route` and a `setWidth` helper.
 */
async function boot(subagents) {
	const host = makeHost({ subagents })
	apply(host.ctx)
	const route = host.registered.routes[0]
	/**
	 * Change the plugin's width the way the composer control does.
	 * @param {number} width - requested width.
	 * @returns {Promise<object>} route payload.
	 */
	async function setWidth(width) {
		const result = await callRoute(route, 'POST', { width })
		assert.equal(result.status, 200)
		return result.body
	}
	await setWidth(0)
	return { ...host, route, setWidth }
}

/**
 * A fake subagents service that resolves every child with a canned report.
 * @returns {object} service plus a `started` array.
 */
function fakeSubagents() {
	const started = []
	const service = {
		list: () => ['spawn-in-process'],
		getProvider: (name) => ({
			name,
			inheritsParentContext: true,
			capabilities: {},
			start: async () => ({})
		}),
		startActivation: async (spec) => {
			const index = started.length
			const childId = `child-${index + 1}`
			started.push({ childId, spec })
			return {
				childId,
				async dispose() {},
				result: Promise.resolve({
					output: [{ type: 'text', text: `report ${index + 1} for ${spec.label}` }],
					stopReason: 'end_turn'
				})
			}
		}
	}
	return { service, started }
}

/** @returns {AbortSignal} a signal that is never cancelled. */
function idleSignal() {
	return new AbortController().signal
}

/** @type {Array<{name: string, run: Function}>} */
const cases = []

/**
 * Register one test case.
 * @param {string} name - case name.
 * @param {Function} run - body.
 */
function test(name, run) {
	cases.push({ name, run })
}

test('mounts exactly one tool, one section and one route', async () => {
	const { registered } = await boot(fakeSubagents().service)
	assert.equal(registered.tools.length, 1)
	assert.equal(registered.tools[0].name, TOOL_NAME)
	assert.equal(typeof registered.tools[0].execute, 'function')
	assert.equal(registered.sections.length, 1)
	assert.equal(registered.sections[0].name, 'force-collab')
	assert.equal(registered.routes.length, 1)
	assert.equal(registered.routes[0].path, ROUTE_STATE)
})

test('the prompt section follows the width', async () => {
	const { registered, setWidth } = await boot(fakeSubagents().service)
	const section = registered.sections[0]
	assert.equal(section.text({ agent: { id: 'parent' } }), '')

	await setWidth(4)
	const text = section.text({ agent: { id: 'parent' } })
	assert.match(text, /宽度 4/)
	assert.match(text, /collab_fanout/)
})

test('fans out exactly width children and aggregates every report', async () => {
	const { service, started } = fakeSubagents()
	const { registered, setWidth } = await boot(service)
	await setWidth(3)
	const tool = registered.tools[0]

	const result = await tool.execute({ brief: '调查这个仓库的结构', angles: ['现状', '风险'] }, {
		agent: { id: 'parent-1' },
		signal: idleSignal()
	})

	assert.equal(started.length, 3)
	assert.equal(result.text.includes('宽度 3'), true)
	assert.equal(result.text.includes('child-1'), true)
	assert.equal(result.text.includes('「现状」'), true)
	assert.equal(result.text.includes('「验证、风险与反例」'), true)
	// The spawned sessions themselves must not be told to fan out again.
	assert.equal(registered.sections[0].text({ agent: { id: 'child-1' } }), '')
})

test('refuses while off and refuses a nested fan-out from a child', async () => {
	const { service } = fakeSubagents()
	const { registered, setWidth } = await boot(service)
	const tool = registered.tools[0]

	await assert.rejects(
		tool.execute({ brief: 'x' }, { agent: { id: 'parent-1' }, signal: idleSignal() }),
		/关闭/
	)

	await setWidth(2)
	await tool.execute({ brief: 'x' }, { agent: { id: 'parent-1' }, signal: idleSignal() })

	await assert.rejects(
		tool.execute({ brief: 'x' }, { agent: { id: 'child-1' }, signal: idleSignal() }),
		/不能再派生子 Agent/
	)
})

test('refuses when no provider is registered', async () => {
	const failing = {
		list: () => [],
		getProvider: () => undefined,
		startActivation: async () => ({})
	}
	const { registered, setWidth } = await boot(failing)
	await setWidth(1)
	await assert.rejects(
		registered.tools[0].execute({ brief: 'x' }, { agent: { id: 'parent-1' }, signal: idleSignal() }),
		/没有注册任何子 Agent provider/
	)
})

test('route reads and writes the width, and validates the range', async () => {
	const { route } = await boot(fakeSubagents().service)

	const initial = await callRoute(route, 'GET')
	assert.equal(initial.status, 200)
	assert.equal(initial.body.width, MIN_WIDTH)

	const written = await callRoute(route, 'POST', { width: 5 })
	assert.equal(written.status, 200)
	assert.equal(written.body.width, 5)
	assert.equal(written.body.enabled, true)

	const rejected = await callRoute(route, 'POST', { width: MAX_WIDTH + 1 })
	assert.equal(rejected.status, 400)

	const wrongMethod = await callRoute(route, 'PUT')
	assert.equal(wrongMethod.status, 405)

	const forbidden = await callRoute(route, 'GET', undefined, '10.0.0.5')
	assert.equal(forbidden.status, 403)
})

test('client half loads through the module loader and seats itself', () => {
	const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

	const fakeReact = {
		createElement: () => ({}),
		useState: (value) => [value, () => {}],
		useEffect: () => {},
		useRef: (value) => ({ current: value }),
		useCallback: (fn) => fn
	}

	/** The definition handed to `window.__ModuleLoader__.load`. */
	let loaded
	const fakeWindow = {
		__ModuleLoader__: {
			load: (definition) => {
				loaded = definition
			}
		}
	}
	const fakeDocument = {
		getElementById: () => null,
		createElement: () => ({
			id: '',
			textContent: '',
			remove: () => {}
		}),
		head: { appendChild: () => {} },
		addEventListener: () => {},
		removeEventListener: () => {}
	}

	// The file is a plain browser script: give it the globals it expects.
	const savedDocument = globalThis.document
	globalThis.document = fakeDocument
	try {
		new Function('window', source)(fakeWindow)
		assert.equal(loaded.id, 'dsh-force-collab')
		const module = loaded.factory(() => fakeReact)
		assert.equal(typeof module.apply, 'function')
		assert.deepEqual(module.inject, ['slots'])

		/** Captured `slots.register` calls. */
		const seats = []
		module.apply({
			effect: (fn) => fn(),
			slots: {
				inject: (_seat, callback) => callback(),
				register: (options, component) => {
					seats.push({ options, component })
					return () => {}
				}
			}
		})
		assert.equal(seats.length, 1)
		assert.equal(seats[0].options.name, 'conversation.input.left')
		assert.equal(seats[0].options.id, 'dsh-force-collab-width')
		assert.equal(typeof seats[0].component, 'function')
	} finally {
		if (savedDocument === undefined) delete globalThis.document
		else globalThis.document = savedDocument
	}
})

let failed = 0
for (const entry of cases) {
	try {
		await entry.run()
		console.log(`ok   ${entry.name}`)
	} catch (error) {
		failed += 1
		console.log(`FAIL ${entry.name}`)
		console.log(error)
	}
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exitCode = failed === 0 ? 0 : 1
