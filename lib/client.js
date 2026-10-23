/**
 * Browser half of the forced-collaboration plugin: the width picker at the left
 * of the composer tool row.
 *
 * The host side of `@deepseek-ai/dsh-client-modules` bundles this file into the
 * Web combo script, so it must stay dependency-free apart from `react` — no JSX,
 * no bundler, no imports, no `react-dom` portal.
 *
 * @module dsh-force-collab/client
 */

window.__ModuleLoader__.load({
	id: 'dsh-force-collab',
	factory: (require) => {
		const React = require('react')
		/** Short alias for `React.createElement`. */
		const h = React.createElement

		const SEAT = 'conversation.input.left'
		const ENTRY_ID = 'dsh-force-collab-width'
		// Keep in sync with lib/protocol.js — the browser half cannot import it.
		const ROUTE_STATE = '/plugins/dsh-force-collab/state'
		const STYLE_ID = 'dsh-force-collab/width.css'
		const MIN_WIDTH = 0
		const MAX_WIDTH = 6
		/** Popover geometry, used to keep the panel on screen. */
		const PANEL_WIDTH = 244
		const PANEL_HEIGHT = 46
		const EDGE = 8

		const CSS = `
.dsw-fc-root {
	position: relative;
	display: inline-flex;
	align-items: center;
	-webkit-app-region: no-drag;
}
.dsw-fc-button {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 26px;
	padding: 0 9px 0 7px;
	border-radius: 7px;
	border: 1px solid transparent;
	background: transparent;
	color: inherit;
	font: inherit;
	font-size: 12px;
	line-height: 1;
	letter-spacing: 0.01em;
	cursor: pointer;
	white-space: nowrap;
	opacity: 0.72;
	transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease, border-color 120ms ease;
}
.dsw-fc-button:hover {
	opacity: 1;
	background: rgba(128, 128, 128, 0.16);
}
.dsw-fc-button:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff);
	outline-offset: 1px;
}
.dsw-fc-button[data-state="on"] {
	opacity: 1;
	color: var(--dsw-alias-brand-primary, #4f7cff);
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 14%, transparent);
	border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 34%, transparent);
}
.dsw-fc-button[data-state="on"]:hover {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 22%, transparent);
}
.dsw-fc-button[data-state="error"] {
	opacity: 1;
	color: #e5484d;
	border-color: rgba(229, 72, 77, 0.5);
	background: rgba(229, 72, 77, 0.1);
}
.dsw-fc-button[data-busy="true"] {
	cursor: progress;
	opacity: 0.85;
}
.dsw-fc-button svg {
	flex: none;
	display: block;
}
.dsw-fc-value {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 1.5em;
	height: 16px;
	padding: 0 4px;
	border-radius: 5px;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	background: color-mix(in srgb, currentColor 14%, transparent);
}
.dsw-fc-panel {
	position: fixed;
	z-index: 2147483000;
	display: flex;
	align-items: center;
	gap: 4px;
	box-sizing: border-box;
	padding: 6px;
	border-radius: 10px;
	background: var(--dsw-alias-bg-elevated, Canvas);
	color: CanvasText;
	border: 1px solid rgba(128, 128, 128, 0.32);
	box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
}
.dsw-fc-chip {
	appearance: none;
	box-sizing: border-box;
	width: 30px;
	height: 30px;
	padding: 0;
	border-radius: 8px;
	border: 1px solid transparent;
	background: rgba(128, 128, 128, 0.12);
	color: inherit;
	font: inherit;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	transition: background-color 110ms ease, color 110ms ease, border-color 110ms ease;
}
.dsw-fc-chip.wide {
	width: 36px;
}
.dsw-fc-chip:hover {
	background: rgba(128, 128, 128, 0.26);
}
.dsw-fc-chip:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary, #4f7cff);
	outline-offset: 1px;
}
.dsw-fc-chip[data-selected="true"] {
	color: #fff;
	border-color: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f7cff) 70%, transparent);
	background: var(--dsw-alias-brand-primary, #4f7cff);
}
.dsw-fc-chip[disabled] {
	cursor: progress;
	opacity: 0.6;
}
@media (prefers-reduced-motion: reduce) {
	.dsw-fc-button, .dsw-fc-chip { transition: none; }
}
`

		/**
		 * The fork glyph: one stem splitting into three branches.
		 * @returns {object} React element.
		 */
		function Glyph() {
			return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, fill: 'none' },
				h('path', { d: 'M3 13V8.5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
				h('path', { d: 'M3 8.5h5', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
				h('path', { d: 'M8 8.5 12 4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
				h('path', { d: 'M8 8.5 12 13', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
				h('circle', { cx: 13.4, cy: 3.2, r: 1.7, stroke: 'currentColor', strokeWidth: 1.1 }),
				h('circle', { cx: 13.4, cy: 12.8, r: 1.7, stroke: 'currentColor', strokeWidth: 1.1 }),
				h('circle', { cx: 2.6, cy: 14.2, r: 1.5, fill: 'currentColor', stroke: 'none' })
			)
		}

		/**
		 * Clamp the popover onto the viewport.
		 * @param {object} rect - the button's bounding rect.
		 * @returns {{left: number, top: number}} viewport coordinates.
		 */
		function placePanel(rect) {
			const viewportWidth = window.innerWidth || 1280
			const left = Math.max(EDGE, Math.min(rect.left, viewportWidth - PANEL_WIDTH - EDGE))
			const above = rect.top - PANEL_HEIGHT - EDGE
			const top = above >= EDGE ? above : rect.bottom + 6
			return { left, top }
		}

		/**
		 * The width picker: "协作" plus a small chooser for 0..6.
		 * @returns {object} React element.
		 */
		function WidthPicker() {
			const [width, setWidth] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [open, setOpen] = React.useState(false)
			const [anchor, setAnchor] = React.useState({ left: EDGE, top: EDGE })
			const [failure, setFailure] = React.useState('')
			const alive = React.useRef(true)
			const root = React.useRef(null)
			const button = React.useRef(null)

			React.useEffect(() => {
				alive.current = true
				fetch(ROUTE_STATE, { credentials: 'same-origin', cache: 'no-store' })
					.then((response) => response.json())
					.then((body) => {
						if (!alive.current) return
						setWidth(typeof body?.width === 'number' ? body.width : MIN_WIDTH)
					})
					.catch(() => {
						if (alive.current) setWidth(MIN_WIDTH)
					})
				return () => {
					alive.current = false
				}
			}, [])

			React.useEffect(() => {
				if (!open) return undefined
				const onDown = (event) => {
					if (root.current !== null && !root.current.contains(event.target)) setOpen(false)
				}
				const onKey = (event) => {
					if (event.key === 'Escape') setOpen(false)
				}
				document.addEventListener('mousedown', onDown, true)
				document.addEventListener('keydown', onKey, true)
				return () => {
					document.removeEventListener('mousedown', onDown, true)
					document.removeEventListener('keydown', onKey, true)
				}
			}, [open])

			const toggle = React.useCallback(() => {
				if (button.current !== null) setAnchor(placePanel(button.current.getBoundingClientRect()))
				setOpen((value) => !value)
			}, [])

			const choose = React.useCallback((next) => {
				if (busy) return
				setBusy(true)
				setOpen(false)
				fetch(ROUTE_STATE, {
					method: 'POST',
					credentials: 'same-origin',
					cache: 'no-store',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ width: next })
				})
					.then(async (response) => {
						const body = await response.json().catch(() => ({}))
						if (!alive.current) return
						if (response.ok && body?.ok === true && typeof body.width === 'number') {
							setWidth(body.width)
							setFailure('')
						} else {
							setFailure(String(body?.error ?? `HTTP ${response.status}`))
						}
					})
					.catch((error) => {
						if (!alive.current) return
						setFailure(error instanceof Error ? error.message : String(error))
					})
					.finally(() => {
						if (alive.current) setBusy(false)
					})
			}, [busy])

			const on = typeof width === 'number' && width > MIN_WIDTH
			const loading = width === null
			const state = failure !== '' ? 'error' : on ? 'on' : 'off'
			const title = failure !== ''
				? `协作宽度设置失败：${failure}（点击重试）`
				: loading
					? '正在读取协作宽度…'
					: on
						? `强制协作：本轮派出 ${width} 个子 Agent。点击修改。`
						: '强制协作已关闭。点击选择 1-6 个子 Agent。'

			const chips = []
			for (let value = MIN_WIDTH; value <= MAX_WIDTH; value += 1) {
				chips.push(h('button', {
					key: value,
					type: 'button',
					className: value === MIN_WIDTH ? 'dsw-fc-chip wide' : 'dsw-fc-chip',
					'data-selected': width === value ? 'true' : 'false',
					'aria-label': value === MIN_WIDTH ? '关闭强制协作' : `强制派出 ${value} 个子 Agent`,
					disabled: busy,
					onClick: () => choose(value)
				}, value === MIN_WIDTH ? '关' : String(value)))
			}

			return h('div', { className: 'dsw-fc-root', ref: root },
				h('button', {
					type: 'button',
					ref: button,
					className: 'dsw-fc-button',
					'data-state': state,
					'data-busy': busy ? 'true' : 'false',
					'aria-haspopup': 'dialog',
					'aria-expanded': open,
					'aria-label': on ? `强制协作已开启，宽度 ${width}` : '强制协作已关闭',
					title,
					onClick: toggle,
					disabled: loading
				},
					h(Glyph),
					h('span', null, '协作'),
					h('span', { className: 'dsw-fc-value' }, loading ? '…' : on ? String(width) : '关')
				),
				open
					? h('div', {
						className: 'dsw-fc-panel',
						role: 'dialog',
						'aria-label': '选择子 Agent 数量',
						style: { left: `${anchor.left}px`, top: `${anchor.top}px` }
					}, chips)
					: null
			)
		}

		/**
		 * Inject the stylesheet once, and remove it when the entry is disposed.
		 * @returns {() => void} cleanup.
		 */
		function installStyles() {
			if (document.getElementById(STYLE_ID) !== null) return () => {}
			const style = document.createElement('style')
			style.id = STYLE_ID
			style.textContent = CSS
			document.head.appendChild(style)
			return () => {
				style.remove()
			}
		}

		/**
		 * Plugin entry point.
		 * @param {object} ctx - client context with `slots`.
		 */
		function apply(ctx) {
			ctx.effect(installStyles, 'force-collab width picker styles')
			ctx.slots.inject(SEAT, () => ctx.slots.register({
				name: SEAT,
				id: ENTRY_ID,
				order: -95
			}, WidthPicker))
		}

		const module = { exports: {} }
		module.exports.apply = apply
		module.exports.inject = ['slots']
		return module.exports
	}
})
