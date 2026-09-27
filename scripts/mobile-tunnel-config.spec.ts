import { expect, it } from 'vitest'
import { quickTunnelOrigin, rotateMobileCommand } from './mobile-tunnel-config.mts'
const command = 'DSH_HOME=/home/user/dsh DSH_MOBILE_PUBLIC_ORIGIN=https://old-link.trycloudflare.com node cli.js web --no-open --trusted-host old-link.trycloudflare.com --trusted-host other.example.test'
it('rotates only the explicit public origin and its exact trust entry', () => {
  const updated = rotateMobileCommand(command, 'https://new-link.trycloudflare.com')
  expect(updated).toBe(command.replaceAll('old-link.trycloudflare.com', 'new-link.trycloudflare.com'))
  expect(rotateMobileCommand(updated, 'https://new-link.trycloudflare.com')).toBe(updated)
})
it('supports quoted bindings and refuses missing or ambiguous bindings before deployment', () => {
  expect(rotateMobileCommand("DSH_MOBILE_PUBLIC_ORIGIN='https://old-link.trycloudflare.com' dsh web --trusted-host='old-link.trycloudflare.com'", 'https://new-link.trycloudflare.com')).toContain("--trusted-host='new-link.trycloudflare.com'")
  for (const bad of ['dsh web', command.replace('--trusted-host old-link.trycloudflare.com', ''), command + ' DSH_MOBILE_PUBLIC_ORIGIN=https://old-link.trycloudflare.com']) expect(() => rotateMobileCommand(bad, 'https://new-link.trycloudflare.com')).toThrow()
})
it.each(['http://x.trycloudflare.com','https://x.trycloudflare.com/path','https://x.trycloudflare.com/?token=x','https://user@x.trycloudflare.com','https://x.trycloudflare.com:8443','https://other.example.test','https://x.trycloudflare.com;echo.test'])('rejects unsafe rotation origins %s', value => {
  expect(() => quickTunnelOrigin(value)).toThrow()
})
