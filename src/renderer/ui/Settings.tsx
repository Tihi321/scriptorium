import { useEffect, useState } from 'react'
import { getStartWithWindows, sendCommand, setStartWithWindows } from '../api'
import { useOffice } from '../store/hooks'
import { officeStore } from '../store/store'

const SMTP_PASSWORD = 'SCRIPTORIUM_SMTP_PASSWORD'
/** Provider key variables the engine usually knows. The engine refuses names that are not in providers.md. */
const KEY_NAMES = ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']

export function SettingsDialog() {
  const open = useOffice((s) => s.settingsOpen)
  const settings = useOffice((s) => s.settings)
  const secretsSet = useOffice((s) => s.secretsSet)
  const [form, setForm] = useState({ kindleAddress: '', fromAddress: '', smtpHost: '', smtpPort: 587, smtpUser: '', smtpSecure: false })
  const [password, setPassword] = useState('')
  const [keyName, setKeyName] = useState(KEY_NAMES[0]!)
  const [keyValue, setKeyValue] = useState('')
  const [login, setLogin] = useState<boolean | null>(null)

  useEffect(() => {
    if (open && settings) setForm({ ...settings })
  }, [open, settings])
  useEffect(() => {
    if (open) void getStartWithWindows().then(setLogin)
  }, [open])

  if (!open) return null
  const close = () => {
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
  const keySet = secretsSet.includes(keyName)
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog settings" onClick={(e) => e.stopPropagation()} data-testid="settings-dialog">
        <div className="panel-title">Settings</div>
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
          <span className="dim">Passwords go to the Windows credential store.</span>
          <button
            className="primary"
            data-testid="settings-save"
            onClick={() => {
              sendCommand({ type: 'saveSettings', ...form })
              if (password) sendCommand({ type: 'setSecret', name: SMTP_PASSWORD, value: password })
              close()
            }}
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
          <button onClick={close} data-testid="settings-close">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
