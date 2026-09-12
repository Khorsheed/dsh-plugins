import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { adaptSafariBundle, isSafariBundleRequest } from '../examples/safari-stream-compat.mjs'

import { validator } from './fixtures/safari-validator.ts'

describe('Safari stream compatibility delivery adapter', () => {
  it('patches complete known copies only, including indented combination bundles', () => {
    const source = `/* before */\n${validator}\n${validator.replaceAll('hasIntrinsicConstructor', 'hasIntrinsicConstructor$2').split('\n').map(x => '\t\t' + x).join('\n')}\n/* after */`
    const result = adaptSafariBundle(source)
    expect(result.status).toBe('patched')
    expect(result.patched).toBe(2)
    expect(result.source).toBe(source.replaceAll('`function ${name}() { [native code] }`', 'Function.prototype.toString.call(globalThis[name])'))
    expect(adaptSafariBundle(result.source)).toEqual({ source: result.source, status: 'not-needed', patched: 0 })
  })
  it('leaves changed or unknown functions untouched instead of applying a broad replacement', () => {
    for (const source of [validator.replace('return false;', 'return true;'), validator.replace('prototype, name', 'value, name'), `const text = '\`function \${name}() { [native code] }\`';`]) {
      expect(adaptSafariBundle(source)).toEqual({ source, status: 'unrecognized', patched: 0 })
    }
    const mixed = validator + '\n' + validator.replace('return false;', 'return true;')
    expect(adaptSafariBundle(mixed).source).toBe(mixed)
  })
  it('retains prototype checks and works across realms without changing global functions', () => {
    const original = Function.prototype.toString
    const check = new Function(adaptSafariBundle(validator).source + ';return hasIntrinsicConstructor')()
    const foreign = vm.runInNewContext('({Object, Array})')
    for (const realm of [globalThis, foreign]) {
      expect(check(realm.Object.prototype, 'Object')).toBe(true)
      expect(check(realm.Array.prototype, 'Array')).toBe(true)
    }
    expect(check(class Custom {}.prototype, 'Object')).toBe(false)
    expect(check({ constructor: Object }, 'Object')).toBe(false)
    expect(check(Object.prototype, 'Array')).toBe(false)
    expect(Function.prototype.toString).toBe(original)
  })
  it('selects iPhone WKWebView and desktop Safari but bypasses other traffic', () => {
    for (const ua of ['iPhone AppleWebKit/605.1.15 Mobile/15E148', 'Macintosh AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', 'iPhone AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148']) {
      const req = { method: 'GET', url: '/plugins/??bundle/client.js&rev=test', headers: { 'user-agent': ua } }
      expect(isSafariBundleRequest(req)).toBe(true)
      expect(isSafariBundleRequest({ ...req, method: 'POST' })).toBe(false)
      expect(isSafariBundleRequest({ ...req, url: '/api/remote.mux' })).toBe(false)
    }
    expect(isSafariBundleRequest({ method: 'GET', url: '/plugins/', headers: { 'user-agent': 'Macintosh AppleWebKit/537.36 Chrome/140.0 Safari/537.36' } })).toBe(false)
  })
})
