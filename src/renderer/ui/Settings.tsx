import { useEffect, useState } from 'react'
import { getStartWithWindows, sendCommand, setStartWithWindows } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'
import type { SettingsSummary } from '../../shared/protocol'

const SMTP_PASSWORD = 'SCRIPTORIUM_SMTP_PASSWORD'
/** Provider key variables the engine usually knows. The engine refuses names that are not in providers.md. */
const KEY_NAMES = ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']

export function SettingsDialog() {
  const open = useOffice((s) => s.settingsOpen)
  const settings = useOffice((s) => s.settings)
  const secretsSet = useOffice((s) => s.secretsSet)
  const [form, setForm] = useState<SettingsSummary>({
    kindleAddress: '',
    fromAddress: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpSecure: false,
    defaultPaidModel: '',
    defaultStrataModel: '',
    defaultLmstudioModel: '',
    modelOrder: [],
    lmstudioParallel: 4,
    lmstudioContext: 32768,
    lmstudioTtlMinutes: 60,
    maxBooksInProgress: 3
  })
  const [password, setPassword] = useState('')
  const [keyName, setKeyName] = useState(KEY_NAMES[0]!)
  const [keyValue, setKeyValue] = useState('')
  const [login, setLogin] = useState<boolean | null>(null)

  // filled once per opening: a snapshot that arrives while the dialog is open (a model was discovered) must not undo your edits
  const [initial, setInitial] = useState<SettingsSummary | null>(null)
  useEffect(() => {
    if (!open) setInitial(null)
    else if (settings && !initial) {
      setForm({ ...settings })
      setInitial(settings)
    }
  }, [open, settings, initial])
  useEffect(() => {
    if (open) void getStartWithWindows().then(setLogin)
  }, [open])

  if (!open) return null
  /**
   * Closing keeps what you changed: Close, a click outside and Save all save it. Only the fields you edited are sent, over the
   * latest settings, so a change made meanwhile elsewhere (the Models panel) is not undone.
   */
  const close = (save = false) => {
    if (initial && settings) {
      const edited = Object.fromEntries((Object.keys(form) as (keyof SettingsSummary)[]).filter((k) => form[k] !== initial[k]).map((k) => [k, form[k]]))
      if (save || Object.keys(edited).length) sendCommand({ type: 'saveSettings', ...settings, ...edited })
    }
    if (password) sendCommand({ type: 'setSecret', name: SMTP_PASSWORD, value: password })
    setPassword('')
    setKeyValue('')
    officeStore.getState().setSettingsOpen(false)
  }
  const field = (label: string, key: 'kindleAddress' | 'fromAddress' | 'smtpHost' | 'smtpUser', type = 'text') => (
    <>
      <label>{label}</label>
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} data-testid={`set-${key}`} />
    </>
  )
  const num = (label: string, key: 'maxBooksInProgress') => (
    <div style={{ flex: 1 }}>
      <label>{label}</label>
      <input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} data-testid={`set-${key}`} />
    </div>
  )
  const keySet = secretsSet.includes(keyName)
  return (
    <div className="dialog-backdrop" onClick={() => close()}>
      <div className="dialog settings" onClick={(e) => e.stopPropagation()} data-testid="settings-dialog">
        <div className="panel-title">Settings</div>
        <div className="row">{num('Books worked on at once', 'maxBooksInProgress')}</div>
        <div className="dim">More books at once keeps more writers busy: each book's chapters are written one after the other.</div>
        <hr />
        <div className="dim">Send to Kindle</div>
        {field('Kindle address', 'kindleAddress')}
        {field('From address (on your Amazon approved list)', 'fromAddress')}
        {field('SMTP host', 'smtpHost')}
        <div className="row">
          <div style={{ flex: 1 }}>
            <label>Port</label>
            <input type="number" value={form.smtpPort} onChange={(e) => setForm({ ...form, smtpPort: Number(e.target.value) })} data-testid="set-smtpPort" />
          </div>
          <label className="row" style={{ marginTop: 18 }}>
            <input type="checkbox" checked={form.smtpSecure} onChange={(e) => setForm({ ...form, smtpSecure: e.target.checked })} style={{ width: 'auto' }} data-testid="set-smtpSecure" />
            secure (TLS)
          </label>
        </div>
        {field('SMTP user', 'smtpUser')}
        <label>SMTP password {secretsSet.includes(SMTP_PASSWORD) ? '(set, not shown)' : '(not set)'}</label>
        <input type="password" autoComplete="off" value={password} placeholder="Type a new password to replace it" onChange={(e) => setPassword(e.target.value)} data-testid="set-password" />
        <div className="row spread" style={{ marginTop: 6 }}>
          <span className="dim">Closing saves too. Passwords go to the Windows credential store.</span>
          <button
            className="primary"
            data-testid="settings-save"
            onClick={() => close(true)}
          >
            Save
          </button>
        </div>
        <hr />
        <div className="dim">Provider API key</div>
        <div className="row">
          <select value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ flex: 1 }}>
            {[...new Set([...KEY_NAMES, ...secretsSet.filter((n) => n !== SMTP_PASSWORD)])].map((n) => (
              <option key={n} value={n}>
                {n}
                {secretsSet.includes(n) ? ' (set)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 4 }}>
          <input type="password" autoComplete="off" style={{ flex: 1 }} value={keyValue} placeholder={keySet ? 'Key is set. Type to replace' : 'Paste the key'} onChange={(e) => setKeyValue(e.target.value)} data-testid="set-key-value" />
          <button
            disabled={!keyValue}
            data-testid="set-key-save"
            onClick={() => {
              sendCommand({ type: 'setSecret', name: keyName, value: keyValue })
              setKeyValue('')
            }}
          >
            Store key
          </button>
        </div>
        <hr />
        <label className="row" style={{ marginTop: 0 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={login === true}
            disabled={login === null}
            data-testid="set-login"
            onChange={(e) => void setStartWithWindows(e.target.checked).then(setLogin)}
          />
          Start Scriptorium with Windows{login === null ? ' (only in the desktop app)' : ''}
        </label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={() => close()} data-testid="settings-close">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
