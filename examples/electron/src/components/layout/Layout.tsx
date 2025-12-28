import { ReactNode } from 'react'

import Header from './Header'

type LayoutProps = {
  sidebar: ReactNode
  main: ReactNode
  eventLog: ReactNode
}

export default function Layout({ sidebar, main, eventLog }: LayoutProps) {
  return (
    <div className="flex flex-col h-screen">
      <Header />
      <div className="grid grid-cols-[300px_1fr_400px] flex-1 overflow-hidden">
        <aside className="border-r border-gray-200 overflow-y-auto p-4 bg-gray-50">{sidebar}</aside>
        <main className="overflow-y-auto p-6 bg-white">{main}</main>
        <aside className="border-l border-gray-200 overflow-y-auto bg-gray-50">{eventLog}</aside>
      </div>
    </div>
  )
}
