import { useState } from 'react'
import { OfficeView } from './office/OfficeView'
import { useOffice } from './store/hooks'
import { AgentPanel, HireDialog, RoleDefaults } from './ui/AgentPanel'
import { AddIdea } from './ui/AddIdea'
import { BookCard } from './ui/BookCard'
import { LibraryView } from './ui/Library'
import { SettingsDialog } from './ui/Settings'
import { officeStore } from './store/store'
import { AskResearcher } from './ui/AskResearcher'
import { Budget } from './ui/Budget'
import { Controls } from './ui/Controls'
import { StatusBar } from './ui/StatusBar'
import { Terminal } from './ui/Terminal'
import { Whiteboard } from './ui/Whiteboard'

export function App() {
  const [hiring, setHiring] = useState(false)
  const view = useOffice((s) => s.view)
  const warning = useOffice((s) => s.warnings[s.warnings.length - 1])
  return (
    <div className="app">
      <div>
        <div className="topbar">
          <span className="brand">SCRIPTORIUM</span>
          <StatusBar />
          <span className="tabs row">
            <button className={view === 'office' ? 'on' : ''} onClick={() => officeStore.getState().setView('office')} data-testid="tab-office">
              Office
            </button>
            <button className={view === 'library' ? 'on' : ''} onClick={() => officeStore.getState().setView('library')} data-testid="tab-library">
              Library
            </button>
          </span>
          <button onClick={() => officeStore.getState().setSettingsOpen(true)} data-testid="settings-open">
            Settings
          </button>
          <button onClick={() => setHiring(true)} data-testid="hire-open">
            Hire
          </button>
          <Controls />
        </div>
        {warning && <div className="warnbar">{warning}</div>}
      </div>
      <div className="middle">
        <div className="stage">
          <div className={view === 'office' ? 'stage-pane' : 'stage-pane hidden'}>
            <OfficeView />
          </div>
          {view === 'library' && <LibraryView />}
        </div>
        <aside className="sidebar">
          <AgentPanel />
          <Whiteboard />
          <Budget />
          <AskResearcher />
          <AddIdea />
          <RoleDefaults />
        </aside>
      </div>
      <Terminal />
      <BookCard />
      <SettingsDialog />
      {hiring && <HireDialog onClose={() => setHiring(false)} />}
    </div>
  )
}
