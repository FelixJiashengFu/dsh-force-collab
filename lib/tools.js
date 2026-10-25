/**
 * The single model-facing tool: `collab_fanout`.
 *
 * The tool deliberately has no count parameter. The user picks the width in the
 * composer; the host reads that number and spawns exactly that many children.
 * A model that wants a different number simply has no way to ask for one.
 *
 * @module dsh-force-collab/tools
 */

import {
	MAX_CHILDREN_PER_PARENT,
	PER_CHILD_TEXT_LIMIT,
	TOTAL_TEXT_LIMIT,
	TOOL_NAME
} from './protocol.js'

/**
 * A failure whose message is meant for the model verbatim.
 */
export class FanoutError extends Error {
	/**
	 * @param {string} message - model-facing explanation.
	 */
	constructor(message) {
		super(message)
		this.name = 'FanoutError'
	}
}

/**
 * Provider names that mean "run the child in this very process", best first.
 * The registry is owned by `@deepseek-ai/dsh-subagent*` packages whose names we
 * cannot import, so this stays a preference list with a capability fallback.
 */
const PREFERRED_PROVIDERS = ['spawn-in-process', 'in-process', 'local', 'subagent', 'default']

/**
 * Default division of labour, used when the model does not pass `angles`.
 * Indexed by width; every entry has exactly that many lines.
 * @type {Record<number, string[]>}
 */
const DEFAULT_ANGLES = {
	1: ['独立完整地完成整份任务'],
	2: ['方案与实现', '验证、风险与反例'],
	3: ['调研与现有实现', '方案与实现改动', '验证、风险与反例'],
	4: ['背景、约束与现状调研', '方案设计与取舍', '具体的实现与改动', '验证、风险与反例'],
	5: ['背景、约束与现状调研', '方案设计与取舍', '具体的实现与改动', '验证与反例', '性能、边界与回归风险'],
	6: [
		'背景、约束与现状调研',
		'方案设计与取舍',
		'具体的实现与改动',
		'验证与反例',
		'性能、边界与回归风险',
		'文档、交付与后续维护'
	]
}

/**
 * Build the schema for an empty-parameter tool.
 * @param {Record<string, object>} properties - field schemas by name.
 * @param {string[]} [required] - names that must be supplied.
 * @returns {object} an object JSON Schema node.
 */
function params(properties, required = []) {
	const schema = { type: 'object', additionalProperties: false, properties }
	if (required.length > 0) schema.required = required
	return schema
}

/**
 * Normalise `angles` into exactly `width` non-empty strings.
 * @param {unknown} angles - model-supplied list.
 * @param {number} width - forced width.
 * @returns {string[]} one assignment per child.
 */
function normalizeAngles(angles, width) {
	const supplied = Array.isArray(angles)
		? angles.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => item !== '')
		: []
	const fallback = DEFAULT_ANGLES[width] ?? DEFAULT_ANGLES[6].slice(0, width)
	const result = []
	for (let index = 0; index < width; index += 1) {
		const angle = supplied[index]
		result.push(angle !== undefined && angle !== '' ? angle : fallback[index] ?? `独立视角 #${index + 1}`)
	}
	return result
}

/**
 * Compose the self-contained prompt one child receives.
 * @param {object} input - prompt inputs.
 * @param {number} input.index - zero-based child index.
 * @param {number} input.width - forced width.
 * @param {string} input.brief - shared brief.
 * @param {string} input.angle - this child's assignment.
 * @returns {string} the child prompt.
 */
function buildPrompt({ index, width, brief, angle }) {
	const n = index + 1
	return [
		`你是第 ${n}/${width} 号协作子 Agent。你是被强制协作工具派出的，数量由用户设定（宽度 ${width}），既不是你自己选的，也不能改。`,
		'',
		'## 任务（所有子 Agent 共享）',
		brief,
		'',
		'## 你这一份的分工',
		angle,
		'',
		'## 工作规则',
		'1. 你看不到主 Agent 的对话，只能依赖上面的任务说明；信息不足时按最合理的解释推进，并在结论里写明你假设了什么。',
		'2. 直接动手：需要读文件就读、需要跑命令就跑、需要搜索就搜。不要反问，不要等待确认。',
		'3. 禁止派生：不要创建、询问或等待任何子 Agent，也不要调用 collab_fanout / subagent / subagent_fork 之类任何派生子 Agent 的工具。',
		'4. 如果任务涉及写文件：只改你分工内、路径明确的文件，避免与其他子 Agent 抢同一个文件；不确定是否该动手改时，先给出可直接执行的改动方案。',
		'5. 结束时输出一份可被主 Agent 原样引用的结论，结构固定为三段：',
		'   - **结论**：你这一份的最终判断或交付物。',
		'   - **证据**：文件路径与行号、命令与输出摘要、检索到的链接。',
		'   - **风险与未决**：你发现但没能解决的问题。',
		'6. 不要写寒暄、不要复述任务原文、不要输出与本任务无关的客套话。'
	].join('\n')
}

/**
 * Pick the provider that starts local children.
 * @param {object} service - the `subagents` service.
 * @param {string | undefined} override - explicit provider name, if configured.
 * @returns {{ name: string, provider: object }} the chosen provider.
 */
function resolveProvider(service, override) {
	if (typeof service.list !== 'function' || typeof service.getProvider !== 'function') {
		throw new FanoutError('子 Agent 服务不可用（subagents 缺少 list/getProvider）：本次强制协作无法派出子 Agent，请直接自己完成任务。')
	}
	const names = service.list().filter((name) => typeof name === 'string' && name !== '')
	if (names.length === 0) {
		throw new FanoutError('当前没有注册任何子 Agent provider：无法派出协作子 Agent，请直接自己完成任务，并提醒用户检查 subagent 插件是否已启用。')
	}
	const candidates = []
	for (const name of names) {
		const provider = service.getProvider(name)
		if (provider === undefined || provider === null) continue
		candidates.push({
			name,
			provider,
			inherits: provider.inheritsParentContext === true,
			preferred: PREFERRED_PROVIDERS.indexOf(name)
		})
	}
	if (candidates.length === 0) {
		throw new FanoutError(`子 Agent provider 列表非空但都取不到实例（${names.join(', ')}）：无法派出子 Agent。`)
	}
	if (typeof override === 'string' && override !== '') {
		const exact = candidates.find((entry) => entry.name === override)
		if (exact !== undefined) return { name: exact.name, provider: exact.provider }
	}
	// Prefer a well-known in-process name, then anything that inherits the
	// parent context (that is what an in-process child does), then a
	// start-capable provider, then whatever is left.
	const ranked = candidates.slice().sort((a, b) => {
		const aRank = a.preferred >= 0 ? a.preferred : a.inherits ? 100 : a.provider.start !== undefined ? 200 : 300
		const bRank = b.preferred >= 0 ? b.preferred : b.inherits ? 100 : b.provider.start !== undefined ? 200 : 300
		return aRank - bRank
	})
	return { name: ranked[0].name, provider: ranked[0].provider }
}

/**
 * Pull the readable text out of a child result.
 * @param {unknown} result - a `SubagentResult`.
 * @returns {string} the report text.
 */
function resultText(result) {
	/** @type {any} */
	const value = result
	const blocks = Array.isArray(value?.output) ? value.output : []
	const parts = []
	let extra = 0
	for (const block of blocks) {
		if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
			parts.push(block.text)
		} else if (block !== null && typeof block === 'object') {
			extra += 1
		}
	}
	let text = parts.join('\n').trim()
	if (text === '') text = '（这个子 Agent 没有返回文本内容。）'
	if (extra > 0) text += `\n\n（另有 ${extra} 个非文本内容块未展开。）`
	if (typeof value?.diagnostic === 'string' && value.diagnostic.trim() !== '') {
		text += `\n\n诊断信息：${value.diagnostic.trim()}`
	}
	return text
}

/**
 * Render the aggregated tool result.
 * @param {object} input - aggregation inputs.
 * @param {number} input.width - the forced width.
 * @param {string[]} input.angles - the assignments.
 * @param {Array<object>} input.settled - one entry per child.
 * @returns {string} markdown-ish report for the parent model.
 */
function aggregate({ width, angles, settled }) {
	const ok = settled.filter((entry) => entry.ok === true).length
	const failed = settled.length - ok
	const lines = []
	lines.push(`## 强制协作结果（宽度 ${width}，由用户设定）`)
	lines.push('')
	lines.push(`子 Agent 成功返回 ${ok}/${settled.length}${failed > 0 ? `，失败 ${failed}` : ''}。`)
	lines.push('')
	if (failed > 0) {
		lines.push('### 失败的子 Agent')
		for (const entry of settled) {
			if (entry.ok === true) continue
			lines.push(`- #${entry.index + 1} "${entry.angle}" · ${entry.label} · ${entry.stopReason ?? 'error'}：${entry.error ?? '未知错误'}`)
		}
		lines.push('')
	}
	let total = 0
	for (const entry of settled) {
		lines.push(`### #${entry.index + 1}/${width} 「${entry.angle}」 · ${entry.label}`)
		lines.push('')
		if (entry.ok !== true) {
			lines.push(`失败：${entry.error ?? '未知错误'}`)
			lines.push('')
			continue
		}
		lines.push(`- child session：\`${entry.childId}\``)
		lines.push(`- stopReason：${entry.stopReason ?? 'unknown'}`)
		lines.push('')
		const body = entry.text.length > PER_CHILD_TEXT_LIMIT
			? `${entry.text.slice(0, PER_CHILD_TEXT_LIMIT)}\n\n（已截断，原始 ${entry.text.length} 字符）`
			: entry.text
		if (total + body.length > TOTAL_TEXT_LIMIT) {
			lines.push('（已达本次协作结果的总体输出上限，剩余子 Agent 的报告被省略。需要时请单独追问对应 child session。）')
			lines.push('')
			break
		}
		total += body.length
		lines.push(body)
		lines.push('')
	}
	lines.push('---')
	lines.push(`下一步：把这些结论合并成一份最终答案。重复的合并掉，冲突的按证据裁决并说明差异，失败的那一份要说明缺口而不是假装成功。`)
	return lines.join('\n')
}

/**
 * Register the tool for one mounted fiber.
 * @param {object} ctx - a context that has `tools`.
 * @param {object} deps - runtime collaborators.
 * @param {import('./state.js').WidthStore} deps.store - the width store.
 * @param {object} deps.ledger - child bookkeeping (`has`, `add`, `count`).
 * @param {object} deps.logger - host logger.
 * @param {string} [deps.providerOverride] - explicit provider name.
 * @returns {Array<() => void>} disposers.
 */
export function mountTools(ctx, deps) {
	const { store, ledger, logger, providerOverride } = deps
	const disposers = []

	/**
	 * Register one definition and remember how to take it back out.
	 * @param {object} definition - a normalised tool definition.
	 */
	function add(definition) {
		const disposable = ctx.tools.register(definition)
		if (typeof disposable === 'function') disposers.push(disposable)
		else if (disposable !== null && disposable !== undefined && typeof disposable.dispose === 'function') {
			disposers.push(() => disposable.dispose())
		}
	}

	add({
		name: TOOL_NAME,
		description: [
			`把当前任务一次性强行分成 N 份，并行派出 N 个子 Agent；N 由用户在输入框左侧的「协作」里选择（1-6），你不能修改它，也没有数量参数。`,
			`调用后你会收到每个子 Agent 的报告（各自独立 session），然后由你汇总成最终答案。`,
			`只有当用户开启了强制协作（宽度≥1）时才能用；宽度为 0 时会直接报错。`,
			`如果你自己就是被本工具派出的子 Agent，调用会被拒绝：直接完成分工并交回结论。`
		].join(' '),
		parameters: params({
			brief: {
				type: 'string',
				description: '给所有子 Agent 的完整任务说明，必须自包含：背景、目标、约束、验收标准、相关文件路径。子 Agent 看不到当前对话。'
			},
			angles: {
				type: 'array',
				items: { type: 'string' },
				description: `可选：按第 1..N 个子 Agent 的顺序分别指定分工/视角（例如 ["接口与数据","渲染与交互","测试与风险"]）。少于 N 个时，剩余子 Agent 使用默认分工。`
			},
			model: {
				type: 'string',
				description: '可选：子 Agent 使用的模型名；留空则继承当前会话的模型路由。'
			}
		}, ['brief']),
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				required: ['text'],
				properties: {
					text: { type: 'string', description: 'All child reports, aggregated.' }
				}
			},
			render: (_args, value) => {
				const text = String(value?.text ?? '')
				return [{ type: 'text', text: text.length > TOTAL_TEXT_LIMIT ? text.slice(0, TOTAL_TEXT_LIMIT) : text }]
			}
		},
		async execute(args, exec) {
			/** @type {any} */
			const parent = exec?.agent
			const signal = exec?.signal instanceof AbortSignal ? exec.signal : new AbortController().signal
			if (parent === null || parent === undefined || typeof parent.id !== 'string') {
				throw new FanoutError('无法确定发起协作的会话（exec.agent 缺失）：本工具只能在正常会话回合里调用。')
			}
			const width = store.width
			if (width < 1) {
				throw new FanoutError('强制协作当前是关闭的（宽度 0）。请不要派出子 Agent，直接用你自己的能力完成；如果确实需要协作，请让用户在输入框左侧的「协作」里选择 1-6。')
			}
			if (ledger.has(parent.id)) {
				throw new FanoutError('你是被 collab_fanout 派出的子 Agent，不能再派生子 Agent：请直接完成你这一份的分工，并把结论交回主 Agent。')
			}
			const brief = typeof args?.brief === 'string' ? args.brief.trim() : ''
			if (brief === '') {
				throw new FanoutError('brief 不能为空：请给出完整、自包含的任务说明（背景、目标、约束、验收标准、相关文件路径）。')
			}
			/** @type {any} */
			const service = ctx.get('subagents')
			if (service === null || service === undefined) {
				throw new FanoutError('子 Agent 服务不可用（subagents 未加载）：无法派出协作子 Agent，请直接自己完成任务。')
			}
			const { name: providerName } = resolveProvider(service, providerOverride)
			const angles = normalizeAngles(args?.angles, width)
			const agentOptions = typeof args?.model === 'string' && args.model.trim() !== ''
				? { model: args.model.trim() }
				: undefined

			logger.info?.(`force-collab: fanning out width=${width} via ${providerName}`)

			const used = ledger.count(parent.id)
			const reservation = ledger.reserve(parent.id, width, MAX_CHILDREN_PER_PARENT)
			if (reservation === undefined) {
				throw new FanoutError(`本会话已使用或预留 ${used} 个子 Agent，再加 ${width} 个会超过上限 ${MAX_CHILDREN_PER_PARENT}。请直接用自己的能力完成任务，或换一个新会话。`)
			}

			/** @type {Array<{ index: number, angle: string, label: string, activation: any }>} */
			const started = []
			try {
				for (let index = 0; index < width; index += 1) {
					const label = `协作 ${index + 1}/${width}`
					const activation = await service.startActivation({
						provider: providerName,
						label,
						request: {
							prompt: [{ type: 'text', text: buildPrompt({ index, width, brief, angle: angles[index] }) }],
							parent,
							signal,
							...(agentOptions === undefined ? {} : { agentOptions })
						},
						signal,
						delivery: 'caller'
					})
					const childId = typeof activation?.childId === 'string' ? activation.childId : `unknown-${index}`
					reservation.commit(childId)
					started.push({ index, angle: angles[index], label, childId, activation })
				}
			} catch (error) {
				reservation.release()
				// Starting is the only step that can leave a half-built fan-out;
				// release whatever did start, then surface the real cause.
				for (const entry of started) {
					try {
						await entry.activation?.dispose?.()
					} catch {
						/* already gone */
					}
				}
				throw new FanoutError(`无法启动协作子 Agent（provider ${providerName}）：${describeError(error)}`)
			} finally {
				reservation.release()
			}

			const settled = await Promise.all(started.map(async (entry) => {
				try {
					const result = await entry.activation.result
					return {
						index: entry.index,
						angle: entry.angle,
						label: entry.label,
						childId: entry.childId,
						ok: true,
						stopReason: typeof result?.stopReason === 'string' ? result.stopReason : undefined,
						text: resultText(result)
					}
				} catch (error) {
					return {
						index: entry.index,
						angle: entry.angle,
						label: entry.label,
						childId: entry.childId,
						ok: false,
						error: describeError(error)
					}
				}
			}))

			for (const entry of started) {
				try {
					await entry.activation?.dispose?.()
				} catch {
					/* already released */
				}
			}

			return { text: aggregate({ width, angles, settled }) }
		}
	})

	return disposers
}

/**
 * Turn a thrown value into a short model-readable sentence.
 * @param {unknown} error - caught value.
 * @returns {string} message text.
 */
function describeError(error) {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
