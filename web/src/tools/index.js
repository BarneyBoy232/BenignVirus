// The projectBV Tools registry. Each entry is a self-contained add-on tool that
// plugs into the dashboard. Add a new tool by dropping a folder under tools/ and
// appending it here — the Tools page and nav pick it up automatically.
import RemotePage from './remote/RemotePage'
import { remoteLogoSvg } from '../ui'

export const TOOLS = [
  {
    id: 'remote',
    name: 'Remote',
    tagline: 'See and control any fleet device — live screen, apps, tabs, on-screen messages, reboot.',
    icon: remoteLogoSvg,
    component: RemotePage,
  },
]
