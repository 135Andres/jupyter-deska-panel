// Preload: `node --import <this file>` installs waive-hooks.mjs. Child node
// processes get it through NODE_OPTIONS.
import { register } from 'node:module'

register('./waive-hooks.mjs', import.meta.url)
