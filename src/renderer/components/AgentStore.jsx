import React, { createContext, useContext, useReducer } from 'react'
import { agentReducer, initialState } from './agentStoreCore'

const AgentStoreContext = createContext(null)

export function AgentStoreProvider({ children }) {
  const [state, dispatch] = useReducer(agentReducer, initialState)
  return (
    <AgentStoreContext.Provider value={{ state, dispatch }}>
      {children}
    </AgentStoreContext.Provider>
  )
}

export function useAgentStore() {
  const ctx = useContext(AgentStoreContext)
  if (!ctx) throw new Error('useAgentStore must be used within AgentStoreProvider')
  return ctx
}
