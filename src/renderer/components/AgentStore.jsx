import React, { createContext, useContext, useMemo, useReducer } from 'react'
import { agentReducer, initialState } from './agentStoreCore'

// Context 薄壳层：逻辑在 agentStoreCore.js（纯函数）
// state 结构与 action 类型见 ./agentStoreCore.js

const AgentStoreContext = createContext(null)

export function AgentStoreProvider({ children }) {
  const [state, dispatch] = useReducer(agentReducer, initialState)
  // useMemo 稳定 value 引用：避免流式输出（state 高频更新）时所有消费者无谓 re-render
  const value = useMemo(() => ({ state, dispatch }), [state])
  return (
    <AgentStoreContext.Provider value={value}>
      {children}
    </AgentStoreContext.Provider>
  )
}

export function useAgentStore() {
  const ctx = useContext(AgentStoreContext)
  if (!ctx) {
    throw new Error('[AgentStore] useAgentStore() must be used within <AgentStoreProvider>')
  }
  return ctx
}
