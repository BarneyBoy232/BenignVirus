// Shows a small, timed message window on the device's screen.
import { BrowserWindow, screen } from 'electron'

let current = null

export function showPopup(text, seconds) {
  const secs = Math.max(1, Math.min(120, Number(seconds) || 5))
  const msg = String(text || '')

  // Only one popup at a time — replace any existing one.
  if (current && !current.isDestroyed()) current.close()

  const area = screen.getPrimaryDisplay().workArea
  const w = 360
  const h = 150
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: area.x + area.width - w - 20,
    y: area.y + area.height - h - 20,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false, // never steal the user's focus
    show: false,
    backgroundColor: '#17191c',
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  // Inject the message as base64 so no character in it can break the HTML/JS.
  const payload = Buffer.from(JSON.stringify({ text: msg })).toString('base64')
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;font:14px/1.5 system-ui,'Segoe UI',sans-serif;color:#e9ebee;background:#17191c}
    .card{box-sizing:border-box;height:100%;border:1px solid #2a2e33;border-left:4px solid #ffd200;border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:8px}
    .title{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1a9}
    .msg{font-size:15px;white-space:pre-wrap;overflow:auto;flex:1}
  </style><div class="card"><div class="title">Message</div><div class="msg" id="m"></div></div>
  <script>document.getElementById('m').textContent=JSON.parse(atob('${payload}')).text;</script>`

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  win.once('ready-to-show', () => win.showInactive())
  current = win

  const timer = setTimeout(() => { if (!win.isDestroyed()) win.close() }, secs * 1000)
  win.on('closed', () => { clearTimeout(timer); if (current === win) current = null })

  return { shown: true, seconds: secs }
}
