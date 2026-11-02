import { useState } from 'react'
import { OfficeView } from './office/OfficeView'
import { useOffice } from './store/hooks'
import { AgentPanel, HireDialog } from './ui/AgentPanel'
import { BookCard } from './ui/BookCard'
import { DraftReader } from './ui/DraftReader'
import { LibraryView } from './ui/Library'
import { NewspaperView } from './ui/Newspaper'
import { ModelsDialog } from './ui/ModelsDialog'
import { SettingsDialog } from './ui/Settings'
import { officeStore } from './store/store'
import { Controls } from './ui/Controls'
import { SideTools } from './ui/SideTools'
import { StatusBar } from './ui/StatusBar'
import { Terminal } from './ui/Terminal'
import { WarnStrip } from './ui/WarnStrip'
import { Whiteboard } from './ui/Whiteboard'

export function App() {
  const [hiring, setHiring] = useState(false)
  const view = useOffice((s) => s.view)
  const warning = useOffice((s) => s.warnings[s.warnings.length - 1])
  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-main">
          <span className="brand">Scriptorium</span>
          <nav className="view-tabs">
            <button className={view === 'office' ? 'on' : ''} onClick={() => officeStore.getState().setView('office')} data-testid="tab-office">
              Office
            </button>
            <button className={view === 'library' ? 'on' : ''} onClick={() => officeStore.getState().setView('library')} data-testid="tab-library">
              Library
            </button>
            <button className={view === 'newspaper' ? 'on' : ''} onClick={() => officeStore.getState().setView('newspaper')} data-testid="tab-newspaper">
              Newspaper
            </button>
          </nav>
          <span className="masthead-spacer" />
          <button className="ghost" onClick={() => officeStore.getState().setModelsOpen(true)} data-testid="models-open">
            Models
          </button>
          <button className="ghost" onClick={() => officeStore.getState().setSettingsOpen(true)} data-testid="settings-open">
            Settings
          </button>
          <button className="ghost" onClick={() => setHiring(true)} data-testid="hire-open">
            Hire
          </button>
          <Controls />
        </div>
        <div className="masthead-status">
          <StatusBar />
        </div>
        <WarnStrip text={warning} />
      </header>
      <div className="middle">
        <div className="stage">
          <div className={view === 'office' ? 'stage-pane' : 'stage-pane hidden'}>
            <OfficeView />
          </div>
          {view === 'library' && <LibraryView />}
          {view === 'newspaper' && <NewspaperView />}
        </div>
        <aside className="sidebar">
          <Whiteboard />
          <AgentPanel />
          <SideTools />
        </aside>
      </div>
      <Terminal />
      <BookCard />
      <DraftReader />
      <SettingsDialog />
      <ModelsDialog />
      {hiring && <HireDialog onClose={() => setHiring(false)} />}
    </div>
  )
}
