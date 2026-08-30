// Injects the operator's mouse/keyboard events into this device, alongside the
// local user's own input (co-control — like a second mouse on the same PC).
// Events arrive from the console over the WebRTC data channel as small JSON objects.
import { mouse, keyboard, Point, Button, Key } from '@nut-tree-fork/nut-js'

// No artificial delays — we want injected input to feel immediate.
mouse.config.autoDelayMs = 0
keyboard.config.autoDelayMs = 0

const BUTTON = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT }

// The console sends coordinates in the pixels of the VIDEO it is looking at, and
// the video is capped at 1920x1080. On anything bigger — a 4K screen, or a
// 150%-scaled laptop panel — those are not this machine's screen pixels, and
// injecting them raw puts every click in the top-left quadrant with the rest of
// the desktop unreachable. The session measures the real screen against the
// captured frame and sets the ratio here.
let scaleX = 1
let scaleY = 1

export function setInputScale(sx, sy) {
  scaleX = Number.isFinite(sx) && sx > 0 ? sx : 1
  scaleY = Number.isFinite(sy) && sy > 0 ? sy : 1
  console.log(`[bv-agent] input scale ${scaleX.toFixed(3)} x ${scaleY.toFixed(3)}`)
}

// Map a browser KeyboardEvent.code (physical key, layout-independent) to a nut Key.
const KEY = (() => {
  const m = {}
  for (let i = 0; i < 26; i++) m['Key' + String.fromCharCode(65 + i)] = Key[String.fromCharCode(65 + i)]
  for (let i = 0; i <= 9; i++) m['Digit' + i] = Key['Num' + i]
  for (let i = 0; i <= 9; i++) m['Numpad' + i] = Key['NumPad' + i]
  for (let i = 1; i <= 12; i++) m['F' + i] = Key['F' + i]
  Object.assign(m, {
    Enter: Key.Enter, NumpadEnter: Key.Enter, Backspace: Key.Backspace, Tab: Key.Tab,
    Space: Key.Space, Escape: Key.Escape, Delete: Key.Delete, Insert: Key.Insert,
    ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
    Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
    CapsLock: Key.CapsLock, Minus: Key.Minus, Equal: Key.Equal,
    BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket, Backslash: Key.Backslash,
    Semicolon: Key.Semicolon, Quote: Key.Quote, Comma: Key.Comma, Period: Key.Period,
    Slash: Key.Slash, Backquote: Key.Grave,
    NumpadDecimal: Key.Decimal, NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract,
    NumpadMultiply: Key.Multiply, NumpadDivide: Key.Divide,
    PrintScreen: Key.Print, ContextMenu: Key.Menu, NumLock: Key.NumLock,
    ScrollLock: Key.ScrollLock, Pause: Key.Pause,
    ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
    ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
    AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
    MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  })
  return m
})()

// Serialise injection so fast bursts can't reorder or overlap.
let chain = Promise.resolve()
export function inject(evt) {
  chain = chain.then(() => run(evt)).catch((e) => console.error('[bv-agent] inject:', e.message))
  return chain
}

async function run(evt) {
  switch (evt.t) {
    case 'm': // mouse move — x,y arrive in captured-video pixels (absolute)
      await mouse.setPosition(new Point(Math.round(evt.x * scaleX), Math.round(evt.y * scaleY)))
      break
    case 'mr': { // mouse move — dx,dy arrive in captured-video pixels (relative)
      // Lock mode: the operator's cursor is captured and hidden, and we nudge THIS
      // machine's real cursor by the same amount. There is only ever one visible
      // cursor — the device's own — so the two can never drift apart.
      const cur = await mouse.getPosition()
      await mouse.setPosition(new Point(Math.round(cur.x + evt.dx * scaleX), Math.round(cur.y + evt.dy * scaleY)))
      break
    }
    case 'd':
      await mouse.pressButton(BUTTON[evt.b] ?? Button.LEFT)
      break
    case 'u':
      await mouse.releaseButton(BUTTON[evt.b] ?? Button.LEFT)
      break
    case 'w':
      if (evt.dy > 0) await mouse.scrollDown(Math.abs(evt.dy))
      else if (evt.dy < 0) await mouse.scrollUp(Math.abs(evt.dy))
      break
    case 'k': {
      const k = KEY[evt.code]
      if (k === undefined) return
      if (evt.a === 'down') await keyboard.pressKey(k)
      else await keyboard.releaseKey(k)
      break
    }
  }
}
