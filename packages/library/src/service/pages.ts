/**
 * Photographed pages: recording (marks carded), listing, photo reads and saves.
 *
 * One layer of the library service (see `service/core.ts` for the layering):
 * the methods are the service's own, moved here verbatim by domain.
 *
 * @module @khorsheed/dsh-library/service/pages
 */
import {
  isThickResource,
  libraryErrorMessage,
  type LibraryAttachmentRef,
  type LibraryCardInput,
  type LibraryCardKind,
  type LibraryCardWriteResult,
  type LibraryMark,
  type LibraryOutcome,
  type LibraryPage,
} from '../types.ts'
import { mintLibraryId } from '../store.ts'
import { refuse, type AttachmentsSlice } from './core.ts'
import { LibraryServiceRoadmap } from './roadmap.ts'

export class LibraryServicePages extends LibraryServiceRoadmap {
  /* --------------------------------------------------------------- pages */

  /**
   * Record one photographed page and card every mark at once (「一键全收」).
   * Uncertain marks are kept on the page but never carded — the learner
   * decides them. Each card's gloss is the mark's recognized gloss, else the
   * learner's handwriting, else a placeholder the learner can fill in.
   */
  async recordPage(request: {
    projectId: string
    resourceId: string
    nodeId?: string
    label?: string
    attachment: LibraryAttachmentRef
    text: string
    marks: readonly LibraryMark[]
  }): Promise<LibraryOutcome<{ page: LibraryPage; cards: LibraryCardWriteResult; uncertain: string[] }>> {
    this.assertAlive('recordPage')
    const project = this.readProjectOrRefusal(request.projectId)
    if ('error' in project) return project
    const resource = this.store.readResource(project.value.id, request.resourceId)
    if (resource === undefined) return refuse('not-found', `no resource ${JSON.stringify(request.resourceId)} in this project — a page belongs to a resource`)
    if (!isThickResource(resource)) return refuse('invalid', `《${resource.title}》 is a thin link — only a thick resource (one with a contents) has pages to photograph`)
    const ref = request.attachment
    if (typeof ref?.attachmentId !== 'string' || typeof ref.mediaType !== 'string' || typeof ref.bytes !== 'number' || typeof ref.width !== 'number' || typeof ref.height !== 'number') {
      return refuse('ref-incomplete', 'attachment needs the image block\'s whole durable reference — { attachmentId, mediaType, bytes, width, height }, copied verbatim; the photo itself is never copied')
    }
    if (request.text.trim() === '') {
      return refuse('invalid', 'text is the page\'s printed text as recognized — a photo-backed question quotes it, so transcribe the page, not only the marks')
    }
    const marks = request.marks.filter(mark => mark.text.trim() !== '')
    const pageId = mintLibraryId('pg')
    const nodeId = request.nodeId
    if (nodeId !== undefined) {
      const roadmap = this.store.readRoadmap(project.value.id, resource.id)
      if (roadmap !== undefined && !roadmap.nodes.some(node => node.id === nodeId)) {
        return refuse('not-found', `no node ${JSON.stringify(nodeId)} on this resource's path — omit nodeId or read the roadmap`)
      }
    }
    const kind: LibraryCardKind = project.value.template === 'language' ? 'word' : 'concept'
    const inputs: LibraryCardInput[] = marks.filter(mark => mark.uncertain !== true).map(mark => ({
      kind,
      term: mark.text,
      gloss: mark.gloss ?? mark.handNote ?? '（待补释义）',
      ...(mark.handNote === undefined ? {} : { userGloss: mark.handNote }),
      ...(mark.sentence === undefined ? {} : { context: { sentence: mark.sentence, pageId, ...(nodeId === undefined ? {} : { nodeId }) } }),
      source: { type: 'photo' as const, ref: pageId, ...(request.label === undefined ? {} : { note: request.label }) },
      resourceId: resource.id,
    }))
    return await this.mutate(project.value.id, () => {
      const cards = this.applyCardInputs(project.value.id, inputs, resource.id, { mergeNear: kind === 'word' })
      const page: LibraryPage = {
        id: pageId,
        resourceId: resource.id,
        ...(nodeId === undefined ? {} : { nodeId }),
        ...(request.label === undefined || request.label.trim() === '' ? {} : { label: request.label.trim() }),
        attachment: { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height },
        text: request.text,
        marks,
        cardIds: [...cards.added, ...cards.merged].map(card => card.id),
        at: new Date().toISOString(),
      }
      this.store.appendPage(project.value.id, page)
      this.event(project.value.id, 'page.recorded', { id: page.id, title: page.label ?? resource.title, resourceId: resource.id, count: cards.added.length, count2: cards.merged.length })
      return { ok: true as const, page, cards, uncertain: marks.filter(mark => mark.uncertain === true).map(mark => mark.text) }
    })
  }

  /** One resource's pages, optionally one node's. */
  async listPages(request: { projectId: string; resourceId: string; nodeId?: string }): Promise<{ pages: LibraryPage[] }> {
    this.assertAlive('listPages')
    const pages = this.store.readPages(request.projectId, request.resourceId)
    return { pages: request.nodeId === undefined ? pages : pages.filter(page => page.nodeId === request.nodeId) }
  }

  /** Find one page anywhere in the project. */
  protected findPage(projectId: string, pageId: string): LibraryPage | undefined {
    for (const resource of this.store.listResources(projectId)) {
      const page = this.store.readPages(projectId, resource.id).find(candidate => candidate.id === pageId)
      if (page !== undefined) return page
    }
    return undefined
  }

  /**
   * One page's photo, as base64 — whitelisted: the page must be one this
   * project recorded, so the Remote never reads an arbitrary attachment.
   */
  async readPagePhoto(request: { projectId: string; pageId: string }): Promise<LibraryOutcome<{ data: string; mediaType: string }>> {
    this.assertAlive('readPagePhoto')
    const page = this.findPage(request.projectId, request.pageId)
    if (page === undefined) return refuse('not-found', `no page ${JSON.stringify(request.pageId)} in this project`)
    const attachments = this.ctx.get('attachments') as AttachmentsSlice | undefined
    if (attachments === undefined) return refuse('unavailable', 'this deployment mounts no attachment store — the photo cannot be read back here')
    try {
      const stored = await attachments.readImage(page.attachment)
      return { ok: true, data: Buffer.from(stored.data).toString('base64'), mediaType: stored.ref.mediaType }
    } catch (error) {
      return refuse('io', `the photo could not be read — ${libraryErrorMessage(error)}`)
    }
  }

  /** Save a browser-uploaded photo into the host attachment store (the sidebar's 拍照). */
  async savePhoto(request: { data: string; mediaType: string }): Promise<LibraryOutcome<{ attachment: LibraryAttachmentRef }>> {
    this.assertAlive('savePhoto')
    const attachments = this.ctx.get('attachments') as AttachmentsSlice | undefined
    if (attachments?.saveImage === undefined) return refuse('unavailable', 'this deployment mounts no attachment store — photos cannot be saved here')
    try {
      const attachment = await attachments.saveImage({ data: Buffer.from(request.data, 'base64'), mediaType: request.mediaType })
      return { ok: true, attachment }
    } catch (error) {
      return refuse('invalid', `the photo was refused — ${libraryErrorMessage(error)}`)
    }
  }

}
