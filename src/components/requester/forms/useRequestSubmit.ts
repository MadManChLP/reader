import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../ConfirmDialog'
import { findActiveRequest, requesterErrorMessage } from '../../../utils/requesterApi'
import type { DownloadRequest } from '../../../types/requester'

export interface SubmitResult {
  success: boolean
  message?: string
}

const SUCCESS_RESET_MS = 2000

/**
 * Shared submit flow for the requester forms:
 * - ignores re-clicks while a request is in flight or its success is showing
 *   (double-click used to file the same request twice);
 * - warns when the loaded history already has an active request for the item;
 * - shows the server's error detail instead of a generic "Request failed";
 * - resets the form 2 s after success, unless the user already started
 *   something new (cancelReset) — the timer used to wipe fresh input — and
 *   never after unmount.
 */
export function useRequestSubmit(onReset: () => void) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [confirm, confirmUi] = useConfirm()
  const busyRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const onResetRef = useRef(onReset)
  onResetRef.current = onReset

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  /** The user picked/typed something new: keep their input, drop the success banner. */
  const cancelReset = useCallback(() => {
    if (timerRef.current === null) return
    clearTimer()
    setResult(null)
  }, [])

  /**
   * @param key   slug / imdb id / URL used for duplicate detection (null = skip)
   * @param label shown in the duplicate warning when the history entry has no title
   * @param run   performs the request; throws on failure
   */
  const submit = useCallback(async (
    key: string | null,
    label: string,
    run: () => Promise<DownloadRequest>,
  ) => {
    if (busyRef.current || timerRef.current !== null) return
    busyRef.current = true
    try {
      const existing = findActiveRequest(key)
      if (existing) {
        const ok = await confirm({
          title: 'Already requested',
          message: `"${existing.title || label}" is already in the queue (${existing.status}). Request it again anyway?`,
          confirmLabel: 'Request again',
        })
        if (!ok) return
      }
      setIsSubmitting(true)
      setResult(null)
      await run()
      setResult({ success: true })
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setResult(null)
        onResetRef.current()
      }, SUCCESS_RESET_MS)
    } catch (e) {
      setResult({ success: false, message: requesterErrorMessage(e, 'Request failed. Please try again.') })
    } finally {
      busyRef.current = false
      setIsSubmitting(false)
    }
  }, [confirm])

  return {
    isSubmitting,
    result,
    submit,
    cancelReset,
    /** Submit button must stay disabled while true */
    locked: isSubmitting || result?.success === true,
    confirmUi,
  }
}
