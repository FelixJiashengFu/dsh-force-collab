/**
 * The model-facing instruction that turns the composer width into behaviour.
 *
 * This is a system-prompt section rather than a tool description, because it
 * has to win against the model's default instinct to just answer. It is also
 * dynamic: `text` is a callback, so flipping the width in the composer changes
 * the very next request without reloading the plugin.
 *
 * Two guards keep the section out of places where it would be wrong:
 * - width 0 (off) renders nothing at all;
 * - a session that this plugin spawned as a child renders nothing, so children
 *   do not try to fan out again. The child's own prompt also tells it who it is,
 *   so even a bookkeeping race cannot deadlock a run.
 *
 * @module dsh-force-collab/prompt
 */

import { SECTION_NAME, SECTION_ORDER } from './protocol.js'

/** Known-good section name published by the bundled subagent tool. */
const ORDER_ANCHOR = 'TOOL_SUBAGENT'

/**
 * Resolve the numeric order of a named prompt section.
 *
 * `getSectionOrder` throws on an unknown name, and the anchor section only
 * exists while the bundled delegation tool is loaded, so a failure falls back
 * to the plugin's own constant.
 *
 * @param {object} ctx - host context with `systemPrompt`.
 * @returns {number} section order.
 */
function sectionOrder(ctx) {
	try {
		const order = ctx.systemPrompt.getSectionOrder(ORDER_ANCHOR)
		if (typeof order === 'number' && Number.isFinite(order)) return order
	} catch {
		/* anchor not present: use the local constant */
	}
	return SECTION_ORDER
}

/**
 * Build the section body for one request.
 * @param {object} deps - collaborators.
 * @param {object} deps.store - width store.
 * @param {object} deps.ledger - child session bookkeeping.
 * @param {object} [context] - prompt assembly context (`agent`, `scope`).
 * @returns {string} markdown-ish section text, or `''` for nothing.
 */
function buildText({ store, ledger }, context) {
	const width = store.width
	if (width < 1) return ''
	const agentId = context?.agent?.id
	if (typeof agentId === 'string' && typeof ledger?.has === 'function' && ledger.has(agentId)) return ''

	return [
		`## 强制协作已开启：宽度 ${width}（用户设定）`,
		'',
		`用户在输入框左侧把协作宽度设成了 **${width}**。这一轮必须派出 ${width} 个子 Agent 分工完成，而不是由你一个人包办。`,
		'',
		'规则：',
		`1. 只有寒暄、单步确认、一两句话就能答完的小问题（例如「你好」「继续」「谢谢」「现在几点」）才可以不派子 Agent。其余一切需要动手的任务——读代码、改文件、搜索调研、排错、写文档、做设计——都必须先调用 \`collab_fanout\` 再动手。`,
		`2. 派子 Agent 的唯一方式是调用 \`collab_fanout\`。它在一次调用里就派出全部 ${width} 个子 Agent，等它们各自返回，再把 ${width} 份报告交回给你。它没有数量参数：${width} 是用户定的，你改不了，也不要试图换成别的数字或分批凑数。`,
		'3. 不要用 `subagent`、`subagent_fork` 或任何其他派工工具：那会绕过用户设定的宽度。',
		'4. 子 Agent 看不到当前对话，所以 `brief` 必须自包含：背景、目标、约束、验收标准、要读或要改的具体文件路径。信息不够就先花一两个只读操作补齐，再派工。',
		`5. 用 \`angles\` 按顺序写清第 1..${width} 个子 Agent 各自负责什么，尽量互不重叠；不写就按默认分工执行。`,
		'6. 拿到全部报告后由你合并成最终答案：重复的合并掉，冲突的按证据裁决并说明差异，失败的那一份要说明缺口，不要假装成功。',
		'7. 如果 `collab_fanout` 报错，如实把原因告诉用户，然后自己完成任务；不要偷偷改派别的工具。',
		'',
		'如果你在任务说明开头看到「你是第 n/N 号协作子 Agent」，说明你本身就是被派出的子 Agent：忽略本节，直接完成你那一份分工并交回结论。'
	].join('\n')
}

/**
 * Register the dynamic section on the system-prompt service.
 * @param {object} ctx - host context with `systemPrompt`.
 * @param {object} deps - collaborators.
 * @param {object} deps.store - width store.
 * @param {object} deps.ledger - child session bookkeeping.
 * @param {object} [deps.logger] - host logger.
 * @returns {() => void} disposer.
 */
export function mountPrompt(ctx, deps) {
	const { logger } = deps
	const text = (context) => buildText(deps, context)
	const registration = ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: sectionOrder(ctx),
		text
	})
	return () => {
		try {
			if (typeof registration === 'function') registration()
			else if (registration !== null && registration !== undefined && typeof registration.dispose === 'function') registration.dispose()
		} catch (error) {
			logger?.warn?.('force-collab: could not remove prompt section: ' + describe(error))
		}
	}
}

/**
 * Turn a caught value into a short message.
 * @param {unknown} error - caught value.
 * @returns {string} message text.
 */
function describe(error) {
	return error instanceof Error ? error.message : String(error)
}
