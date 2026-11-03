/**
 * Preview server config for the manual UI fixtures in this directory: the
 * repo's source-plane preset (harness sources, one React, CSS modules), as a
 * dev server. vite is not a direct dependency; vitest carries it. From
 * packages/room:
 *   node "$(node -p "require('path').join(require('module').createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'), '../bin/vite.js')")" tests/preview --config tests/preview/vite.config.ts --host 127.0.0.1
 */
import { dshTestConfig } from '../../../../build/vitest.ts'

const config = dshTestConfig()
export default { ...config, test: undefined, cacheDir: 'node_modules/.vite-preview' }
