/**
 * sync-icon-artwork pins: the upstream-module parser (wrappers, local and
 * shared artworks, composites, stroke consts, path consts), the flattening
 * renderer, the missing-name error, and output idempotence. All fixtures are
 * synthetic — the real harness checkout is a dev-time input, not a test one.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectIconUsage, parseUpstreamIcons, renderIconModule } from './sync-icon-artwork.mts'

const FIXTURE_SHARED = `import type { IconProps } from './props.ts'

interface WeightedArtworkProps extends IconProps {
  strokeWidth: number
}

/** Render shared globe geometry. */
export const GlobeOutlineArtwork = ({ size = 14, className, strokeWidth }: WeightedArtworkProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M0 0H16" stroke="currentColor" />
  </svg>
)
`

const FIXTURE_INDEX = `import type { IconProps } from './props.ts'
import { GlobeOutlineArtwork } from './shared-artwork.tsx'

export type { IconProps } from './props.ts'

interface WeightedIconProps extends IconProps {
  strokeWidth: number
}

/** Shared shield contour. */
export const SHIELD_OUTLINE_PATH = 'M1 1L2 2Z'

/** Regular stroke width used by the product icon set. */
export const ICON_REGULAR_STROKE = 1

/** Medium stroke width used by emphasized product icons. */
export const ICON_MEDIUM_STROKE = 1.3

/** Regular one-pixel IconGlobeOutline artwork. */
export const IconGlobeOutlineRegular = (props: IconProps) => (
  <GlobeOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconGlobeOutline artwork with a 1.3px stroke. */
export const IconGlobeOutlineMedium = (props: IconProps) => (
  <GlobeOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconCheckOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M2 8L6 12L14 4" stroke="currentColor" />
  </svg>
)

/** Regular one-pixel IconCheckOutline artwork. */
export const IconCheckOutlineRegular = (props: IconProps) => (
  <IconCheckOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconCheckOutline artwork with a 1.3px stroke. */
export const IconCheckOutlineMedium = (props: IconProps) => (
  <IconCheckOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconStopFillArtwork = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 4H12V12H4V4Z" fill="currentColor" />
  </svg>
)

/** Medium IconStopFill artwork; fill-only geometry is weight-independent. */
export const IconStopFillMedium = (props: IconProps) => (
  <IconStopFillArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconListPenOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d="M1 1H15" stroke="currentColor" />
  </svg>
)

const IconPlanOutlineArtwork = (props: WeightedIconProps) => (
  <IconListPenOutlineArtwork {...props} size={props.size ?? 14} />
)

/** Regular one-pixel IconListPenOutline artwork. */
export const IconListPenOutlineRegular = (props: IconProps) => (
  <IconListPenOutlineArtwork {...props} strokeWidth={ICON_REGULAR_STROKE} />
)

/** Medium IconPlanOutline artwork with a 1.3px stroke. */
export const IconPlanOutlineMedium = (props: IconProps) => (
  <IconPlanOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)

const IconShieldOutlineArtwork = ({ size = 16, className, strokeWidth }: WeightedIconProps) => (
  <svg width={size} height={size} className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" strokeWidth={strokeWidth}>
    <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeLinejoin="round" />
  </svg>
)

/** Medium IconShieldOutline artwork with a 1.3px stroke. */
export const IconShieldOutlineMedium = (props: IconProps) => (
  <IconShieldOutlineArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />
)
`

const upstream = () => parseUpstreamIcons(FIXTURE_INDEX, FIXTURE_SHARED, 'v0.0.0-test, harness deadbee')

describe('parseUpstreamIcons', () => {
  it('collects wrappers, artworks, stroke consts and path consts from both modules', () => {
    const parsed = upstream()
    expect(parsed.wrappers.size).toBe(8)
    expect(parsed.strokeValues.get('ICON_MEDIUM_STROKE')).toBe('1.3')
    expect(parsed.strokeValues.get('ICON_REGULAR_STROKE')).toBe('1')
    expect(parsed.pathConsts.get('SHIELD_OUTLINE_PATH')).toBe("'M1 1L2 2Z'")
    // Local, shared, fill (strokeWidth-less) and composite artworks all land.
    expect(parsed.artworks.get('IconCheckOutlineArtwork')?.sizeDefault).toBe(16)
    expect(parsed.artworks.get('GlobeOutlineArtwork')?.sizeDefault).toBe(14)
    expect(parsed.artworks.get('IconStopFillArtwork')?.svg).not.toContain('strokeWidth')
    expect(parsed.artworks.get('IconPlanOutlineArtwork')?.sizeDefault).toBe(14)
  })

  it('throws when a wrapper references an artwork neither module carries', () => {
    expect(() => parseUpstreamIcons(
      FIXTURE_INDEX + `\nexport const IconGhostMedium = (props: IconProps) => (\n  <MissingArtwork {...props} strokeWidth={ICON_MEDIUM_STROKE} />\n)\n`,
      FIXTURE_SHARED,
      'test',
    )).toThrow(/MissingArtwork/)
  })
})

describe('renderIconModule', () => {
  it('flattens Medium wrappers to self-contained components with the literal stroke and the artwork size default', () => {
    const out = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconCheckOutlineMedium'])
    expect(out).toContain('export const IconCheckOutlineMedium = ({ size = 16, className }: IconProps) => (')
    expect(out).toContain('strokeWidth={1.3}')
    expect(out).not.toContain('strokeWidth={strokeWidth}')
    expect(out).toContain('<path d="M2 8L6 12L14 4" stroke="currentColor" />')
    expect(out).toContain('export interface IconProps')
  })

  it('renders a Regular wrapper with the 1px stroke and a shared-module artwork', () => {
    const out = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconGlobeOutlineRegular'])
    expect(out).toContain('export const IconGlobeOutlineRegular = ({ size = 14, className }: IconProps) => (')
    expect(out).toContain('strokeWidth={1}')
  })

  it('flattens a composite artwork with its size override', () => {
    const out = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconPlanOutlineMedium'])
    expect(out).toContain('export const IconPlanOutlineMedium = ({ size = 14, className }: IconProps) => (')
    expect(out).toContain('<path d="M1 1H15" stroke="currentColor" />')
  })

  it('emits a referenced shared path const, and only then', () => {
    const withShield = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconShieldOutlineMedium'])
    expect(withShield).toContain("const SHIELD_OUTLINE_PATH = 'M1 1L2 2Z'")
    const withoutShield = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconCheckOutlineMedium'])
    expect(withoutShield).not.toContain('SHIELD_OUTLINE_PATH')
  })

  it('fails loud on an icon the harness checkout does not export', () => {
    expect(() => renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconNoSuchGlyphMedium']))
      .toThrow(/IconNoSuchGlyphMedium/)
  })

  it('is idempotent and order-stable', () => {
    const a = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconStopFillMedium', 'IconCheckOutlineMedium'])
    const b = renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconCheckOutlineMedium', 'IconStopFillMedium'])
    expect(a).toBe(b)
    expect(renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconCheckOutlineMedium']))
      .toBe(renderIconModule(upstream(), '@khorsheed/dsh-x', ['IconCheckOutlineMedium']))
  })
})

describe('collectIconUsage', () => {
  it('collects Icon* value imports from the primitives root, skipping type-only and other packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-icon-artwork-'))
    const client = join(root, 'src', 'client')
    mkdirSync(client, { recursive: true })
    writeFileSync(join(client, 'A.tsx'), [
      "import { Button, IconCheckOutlineMedium, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'",
      "import type { IconSearchOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'",
      "import { IconTrashOutlineMedium } from '@khorsheed/dsh-other'",
      "import { IconGhostMedium } from './icons.tsx'",
    ].join('\n'))
    mkdirSync(join(client, 'detail'), { recursive: true })
    writeFileSync(join(client, 'detail', 'B.tsx'), "import {\n  IconCopyOutlineMedium,\n} from '@deepseek-ai/dsh-client-ui-primitives'\n")
    expect(collectIconUsage(root)).toEqual(['IconCheckOutlineMedium', 'IconCopyOutlineMedium'])
  })
})
