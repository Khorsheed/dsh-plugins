/**
 * Inline stylesheet (string) injected by the client half. Kept as a plain
 * string so the external bundle needs no CSS build step.
 */
const STYLES: string = `/* message-tools: user-message shadow styles. Token-driven, dark/light adapts. */
.mt-user-message {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: min(525px, 82%);
  margin-left: auto;
}
.mt-bubble {
  max-width: 100%;
  background: var(--dsw-specific-bubble);
  border-radius: 18px;
  padding: 10px 16px;
  font-size: 16px;
  line-height: 24px;
  color: var(--dsw-alias-label-primary);
}
/* Actions: hover-revealed, 28px hit area. */
.mt-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.15s;
}
.mt-user-message:hover .mt-actions { opacity: 1; }
.mt-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--dsw-alias-label-primary-dimmed);
}
.mt-actions button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
/* Inline editor: same radius as bubble (18px), auto-height, max 240px. */
.mt-editor-box {
  width: 100%;
  border: 1px solid var(--dsw-static-deepseek-200);
  border-radius: 18px;
  overflow: hidden;
}
.mt-editor-box textarea {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 10px 16px;
  font-size: 16px;
  line-height: 24px;
  font-family: inherit;
  resize: none;
  outline: none;
  min-height: 68px;
  max-height: 240px;
  overflow-y: auto;
  display: block;
}
.mt-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  border-top: 1px solid var(--dsw-static-deepseek-200);
}
.mt-model-chip {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  border-radius: 24px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
/* Withdrawn divider: label centered in a full-width line. */
.mt-withdrawn-zone {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 14px 0;
  padding: 0;
}
.mt-withdrawn-zone::before,
.mt-withdrawn-zone::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--dsw-alias-label-primary-dimmed);
  opacity: 0.4;
}
.mt-withdrawn-label {
  flex-shrink: 0;
  margin: 0 16px;
  color: var(--dsw-alias-label-primary-dimmed);
  font-size: 12px;
  letter-spacing: 1px;
  line-height: 1;
}
`
export default STYLES
