/**
 * T90 · the 添加题集 dialog: three fields and one action.
 *
 * 数据在哪 (required) / 题集名称 (required) / 想拿它测什么 (optional), then
 * 「让 Agent 整理」: the caller opens a NEW 「题集整理」 session and writes the
 * request into its chat box — never sends it (decision B: organizing never
 * runs in the session the person is working in). The footer says why git is
 * involved in one sentence a person who does not know git can read.
 *
 * The register form survives under 「高级」: a repository that is already in
 * the protocol layout and committed can still be registered directly.
 *
 * T95 · both paths can be picked with the host's directory chooser — the same
 * probe and degradation the register form uses (`canPick` false hides the
 * buttons; the text stays editable either way). 「选择目录…」 writes the pick
 * into 数据在哪 (still editable: a file, a dataset name or a link are typed);
 * 「更改…」 picks the PARENT of the new repository (`<parent>/<name>`, the
 * `repoPathFor` rule), and 「恢复默认」 goes back to the datasets home. A
 * cancelled pick, or a chooser that fails, changes nothing.
 *
 * T96 · 新仓库位置 is a field of its own: a label, a read-only one-line path
 * (the middle gives way to `…`, the dataset's own folder always shows; the
 * full path is the tooltip and what a copy takes), 「更改…」 beside it in the
 * same action column as 「选择目录…」 — same size, same right edge — and,
 * once changed, 「恢复默认」 under it, an outline button of the same width. The dialog keeps the
 * host Modal's default width, the width 新建实验 uses.
 */

import { useId, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DatasetsViewProps } from './contract.ts'
import { checkDatasetName, cleanPickedPath, repoParentOf, repoPathFor, splitPathTail, type AddDatasetFields } from './organize.ts'
import css from './Organize.module.css'

/**
 * The 添加题集 dialog.
 * @param props - open state, the datasets home for the path hint, and the two exits.
 */
export function AddDatasetDialog(props: {
  open: boolean
  /** The datasets home (decision C), '' while unknown. */
  datasetsHome: string
  onClose: () => void
  onOrganize: (fields: AddDatasetFields) => void
  /** 「高级」: the direct register form. */
  onAdvanced: () => void
  /** Whether the host's directory chooser is reachable (the register form's probe). */
  canPick: boolean
  /** The host's directory chooser; null when the person cancelled. */
  pickDirectory: () => Promise<string | null>
  t: DatasetsViewProps['t']
}) {
  const { open, datasetsHome, onClose, onOrganize, onAdvanced, canPick, pickDirectory, t } = props
  const ids = useId()
  const [source, setSource] = useState('')
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  // The picked parent of the new repository; null = the datasets home.
  const [repoParent, setRepoParent] = useState<string | null>(null)
  const trimmed = name.trim()
  const nameOk = checkDatasetName(trimmed)
  const nameMessage = trimmed !== '' && !nameOk ? t('add.nameBad') : null
  const ready = source.trim() !== '' && nameOk
  const parent = repoParentOf(datasetsHome, repoParent)
  const repo = repoPathFor(parent, nameOk ? trimmed : t('add.repoNameSlot'))
  const [repoHead, repoTail] = splitPathTail(repo)

  /** One pick; a cancel (null) or a failing chooser leaves the field as it was. */
  const pick = (apply: (path: string) => void): void => {
    void pickDirectory().then((chosen) => {
      const path = chosen === null ? '' : cleanPickedPath(chosen)
      if (path !== '') apply(path)
    }, () => undefined)
  }

  const submit = (): void => {
    if (!ready) return
    onOrganize({ source, name: trimmed, purpose, ...(repoParent !== null ? { repoParent } : {}) })
    setSource(''); setName(''); setPurpose(''); setRepoParent(null)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('add.title')}
      description={t('add.description')}
      closeLabel={t('add.close')}
      className={css.addDialog as string}
      footer={(
        <>
          <Button variant="outline" size="sm" onClick={onClose}>{t('add.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={!ready} onClick={submit}>{t('add.organize')}</Button>
        </>
      )}
    >
      <div className={`${css.form} ${css.addForm}`}>
        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-source`}>
            {t('add.source')}<span className={css.required}>{t('add.required')}</span>
          </label>
          <div className={css.pickRow}>
            <textarea
              id={`${ids}-source`}
              className={css.textarea}
              rows={2}
              value={source}
              onChange={(e) => { setSource(e.target.value) }}
              placeholder={t('add.sourcePlaceholder')}
              aria-label={t('add.source')}
            />
            {canPick && (
              <div className={css.pickActions}>
                <Button variant="outline" type="button" size="sm" onClick={() => { pick(setSource) }}>
                  {t('add.browse')}
                </Button>
              </div>
            )}
          </div>
          <div className={css.help}>{t('add.sourceHelp')}</div>
        </div>

        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-name`}>
            {t('add.name')}<span className={css.required}>{t('add.required')}</span>
          </label>
          <Input
            id={`${ids}-name`}
            value={name}
            onChange={(e) => { setName(e.target.value) }}
            placeholder={t('add.namePlaceholder')}
            aria-label={t('add.name')}
            aria-invalid={nameMessage !== null}
            aria-describedby={`${ids}-name-help`}
          />
          <div id={`${ids}-name-help`} className={nameMessage === null ? css.help : css.error} role={nameMessage === null ? undefined : 'alert'}>
            {nameMessage ?? t('add.nameHelp')}
          </div>
        </div>

        <div className={css.formRow}>
          <span className={css.formLabel} id={`${ids}-repo`}>{t('add.repo')}</span>
          <div className={css.pickRow}>
            <div
              className={css.pathBox}
              data-repo-path=""
              role="textbox"
              aria-readonly="true"
              aria-labelledby={`${ids}-repo`}
              aria-describedby={`${ids}-repo-help`}
              tabIndex={0}
              title={repo}
            >
              <span className={css.pathHead}>{repoHead}</span>
              <span className={css.pathTail}>{repoTail}</span>
            </div>
            {canPick && (
              <div className={css.pickActions}>
                <Button variant="outline" type="button" size="sm" onClick={() => { pick(setRepoParent) }}>
                  {t('add.repoChange')}
                </Button>
              </div>
            )}
          </div>
          <div id={`${ids}-repo-help`} className={css.help}>
            {repoParent === null ? t('add.repoHelp') : t('add.repoHelpPicked')}
            {repoParent !== null && (
              <button type="button" className={css.inlineLink} onClick={() => { setRepoParent(null) }}>
                {t('add.repoReset')}
              </button>
            )}
          </div>
        </div>

        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor={`${ids}-purpose`}>
            {t('add.purpose')}<span className={css.optional}>{t('add.optional')}</span>
          </label>
          <textarea
            id={`${ids}-purpose`}
            className={css.textarea}
            rows={2}
            value={purpose}
            onChange={(e) => { setPurpose(e.target.value) }}
            placeholder={t('add.purposePlaceholder')}
            aria-label={t('add.purpose')}
          />
        </div>

        <div className={css.gitNote}>
          <div>{t('add.git')}</div>
          <div className={css.help}>{t('add.gitNeeded')}</div>
        </div>

        <button type="button" className={css.link} onClick={onAdvanced}>{t('add.advanced')}</button>
      </div>
    </Modal>
  )
}
