import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirm } from '../../ConfirmDialog'
import { findActiveRequest, requesterErrorMessage, RequesterError, duplicateSeasons } from '../../../utils/requesterApi'
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
 * - warns when the loaded history already has an active request for the item
 *   (key), or when the server answers 409 (anime/series: those seasons are
 *   already on their way) — "Request anyway" resends with force: true;
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
   * @param run   performs the request (force = answer a 409 duplicate); throws on failure
   */
  const submit = useCallback(async (
    key: string | null,
    label: string,
    run: (force: boolean) => Promise<DownloadRequest>,
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
      try {
        await run(false)
      } catch (e) {
        if (!(e instanceof RequesterError) || e.status !== 409) throw e
        const seasons = duplicateSeasons(e)
        setIsSubmitting(false)
        const ok = await confirm({
          title: 'Already requested',
          message: seasons && seasons.length
            ? `${seasons.length === 1 ? 'Season' : 'Seasons'} ${seasons.join(', ')} of "${label}" ${seasons.length === 1 ? 'is' : 'are'} already requested in this language and still on the way. Request anyway?`
            : `${e.message} Request anyway?`,
          confirmLabel: 'Request anyway',
        })
        if (!ok) return
        setIsSubmitting(true)
        await run(true)
      }
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
