/**
 * The words a settling `room/delivery-state` edge carries in its `text` that
 * the browser reads back (the receipt line under a human message): shared by
 * the host that writes them and the client that recognizes them. Pure
 * constants — the client bundle imports this module.
 * @module @khorsheed/dsh-room/delivery-notes
 */

/** A message that answered the question its recipient was waiting on: delivered as that answer, not as a round of its own. */
export const ANSWERED_QUESTION_TEXT = '作为对它提问的回答送达'

/** A queued human message the human took back before its member reached it (the receipt's 撤回). */
export const WITHDRAWN_TEXT = '人撤回了这条'
