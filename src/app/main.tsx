import { render } from 'preact'
import { App } from './App'

const host = document.getElementById('app')

if (host) render(<App />, host)
