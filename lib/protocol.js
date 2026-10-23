/**
 * Constants shared by the host half and the browser half.
 *
 * The browser half is shipped as plain JS and may only `require('react')`, so
 * it cannot import this module; the two route strings are duplicated in
 * `lib/client.js` with a comment pointing back here.
 *
 * @module dsh-force-collab/protocol
 */

/** URL prefix owned by this plugin. */
export const ROUTE_PREFIX = '/plugins/dsh-force-collab'

/** `GET` reads the current collaboration width, `POST` changes it. */
export const ROUTE_STATE = `${ROUTE_PREFIX}/state`

/** Smallest selectable width. `0` means "off": no forcing at all. */
export const MIN_WIDTH = 0

/** Largest selectable width. */
export const MAX_WIDTH = 6

/** Width of a profile that never touched the selector. */
export const DEFAULT_WIDTH = 0

/** The one model-facing tool this plugin registers. */
export const TOOL_NAME = 'collab_fanout'

/**
 * Built-in delegation tools that are refused while forcing is on.
 *
 * A name starting with `subagent_` is a delegation provider tool (for example
 * `subagent_codex`); `subagent` and `subagent_fork` are the bundled ones.
 */
export const DELEGATION_TOOL_NAMES = new Set(['subagent', 'subagent_fork'])

/** Prefix that marks any other delegation provider tool. */
export const DELEGATION_TOOL_PREFIX = 'subagent_'

/** Prompt section name, so re-registration can replace it cleanly. */
export const SECTION_NAME = 'force-collab'

/** Prompt section order: after the tool instructions, before volatile context. */
export const SECTION_ORDER = 900

/** How many children one parent session may spawn over its whole life. */
export const MAX_CHILDREN_PER_PARENT = 36

/** Largest single child report inlined into the tool result. */
export const PER_CHILD_TEXT_LIMIT = 24_000

/** Largest whole tool result inlined into the model context. */
export const TOTAL_TEXT_LIMIT = 96_000
