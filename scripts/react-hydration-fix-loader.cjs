// Webpack loader (wired in next.config.mjs) that backports a React hydration fix into the copy of React that Next 15
// bundles for the browser (next/dist/compiled/react-dom). Every Next 15 release ships React without it; React 19.3.1 and
// Next 16 include it, so delete this loader and its rule when upgrading to Next 16.
//
// The bug: hydration starts while the page's RSC data is still streaming in. When an element's children are a part of
// that data that has not arrived yet, React suspends inside the element and, once the data lands, replays the element's
// beginWork. The replay claims the element's DOM node again, but the hydration cursor has already moved into the element,
// so React compares the element with its own first child, finds e.g. <div> vs <li>, and throws React #418
// ("server rendered HTML didn't match the client"), then re-renders the whole page on the client. It hit random pages
// (whichever element the data stream happened to be cut at) and only when the server streamed slowly enough.
//
// The fix (React's popHydrationStateOnInterruptedWork, applied in replaySuspendedUnitOfWork): before replaying a host
// element that is the current hydration parent, step the cursor back out so the replay claims the same DOM node again.
const FIXED = /nextHydratableInstance\s*=\s*\w+\.stateNode\)/
// `case 5:` is HostComponent; production builds name the fiber `next`, development builds `unitOfWork`
const SITE = /(case 5:\s*resetHooksOnUnwind\((\w+)\);)(\s*default:)/

module.exports = function reactHydrationFixLoader(source) {
  if (!source.includes('function replaySuspendedUnitOfWork') || FIXED.test(source)) return source
  const m = SITE.exec(source)
  const known = ['hydrationParentFiber', 'isHydrating', 'popToNextHostParent', 'nextHydratableInstance'].every(n => source.includes(n))
  if (!m || !known) {
    this.emitWarning(new Error(`react-hydration-fix-loader: ${this.resourcePath} no longer has the expected code, so the React #418 fix was not applied. If Next was upgraded to 16+, remove this loader; otherwise update it.`))
    return source
  }
  const f = m[2]
  const fix = ` ${f} === hydrationParentFiber && (isHydrating ? (popToNextHostParent(${f}), 5 === ${f}.tag && null != ${f}.stateNode && (nextHydratableInstance = ${f}.stateNode)) : (popToNextHostParent(${f}), (isHydrating = !0)));`
  return source.slice(0, m.index) + m[1] + fix + m[3] + source.slice(m.index + m[0].length)
}
