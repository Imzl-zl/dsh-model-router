import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = 'packages/dsh-model-router/src'
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = join(dir, e.name)
  return e.isDirectory() ? walk(full) : e.name.endsWith('.ts') ? [full] : []
})

let withFallback = 0
let bare = 0
for (const file of walk(root)) {
  const before = readFileSync(file, 'utf8')
  let after = before.split('var(--dsw-alias-brand-primary, #4A65E8)').join('var(--dsh-router-accent)')
  after = after.split('var(--dsw-alias-brand-primary)').join('var(--dsh-router-accent)')
  if (after === before) continue
  withFallback += (before.match(/var\(--dsw-alias-brand-primary, #4A65E8\)/g) ?? []).length
  bare += (before.match(/var\(--dsw-alias-brand-primary\)/g) ?? []).length
  writeFileSync(file, after)
  console.log(file)
}
console.log('with-fallback:', withFallback, 'bare:', bare)

// Strip the never-firing #4A65E8 fallback on the plugin's own accent token: the
// token is declared at :root by this very stylesheet, so the fallback is dead.
let stripped = 0
for (const file of walk(root)) {
  const before = readFileSync(file, 'utf8')
  const after = before.split('var(--dsh-router-accent, #4A65E8)').join('var(--dsh-router-accent)')
  if (after === before) continue
  stripped += (before.match(/var\(--dsh-router-accent, #4A65E8\)/g) ?? []).length
  writeFileSync(file, after)
}
console.log('dead #4A65E8 fallbacks stripped:', stripped)
