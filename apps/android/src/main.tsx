import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('missing #root')
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>)
