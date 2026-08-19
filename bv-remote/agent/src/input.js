// Injects the operator's mouse/keyboard events into this device, alongside the
// local user's own input (co-control — like a second mouse on the same PC).
// Events arrive from the console over the WebRTC data channel as small JSON objects.
import { mouse, keyboard, Point, Button, Key } from '@nut-tree-fork/nut-js'

// No artificial delays — we want injected input to feel immediate.
mouse.config.autoDelayMs = 0
keyboard.config.autoDelayMs = 0

const BUTTON = { 0: Button.LEFT, 1: Button.MIDDLE, 2: Button.RIGHT }

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
    case 'm': // mouse move — x,y already in remote screen pixels
      await mouse.setPosition(new Point(Math.round(evt.x), Math.round(evt.y)))
      break
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
