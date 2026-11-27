import { useCallback, useState } from 'react'
import { useRequester } from '../RequesterContext'
import { useConfirm } from '../../ConfirmDialog'
import { useToast } from '../../Toast'
import { useRequesterLive } from '../../../stores/requesterLiveStore'
import {
  cancelRequest, retryRequest, getRequestError, deleteHistoryEntry, clearHistory, requesterErrorMessage,
} from '../../../utils/requesterApi'

const nameOf = (id: number) => {
  const r = useRequesterLive.getState().history.find(h => h.id === id)
  return r?.title || r?.slug || r?.url || undefined
}

/** Cancel / retry / error details / delete / clear — shared by the list and the detail page. */
export function useRequestActions() {
  const { serverUrl, token } = useRequester()
  const [confirm, confirmUi] = useConfirm()
  const toast = useToast()
  const [busyId, setBusyId] = useState<number | null>(null)

  const cancel = useCallback(async (id: number, episode?: string) => {
    if (!serverUrl || !token) return
    const ok = await confirm({
      title: episode ? `Cancel ${episode}?` : 'Cancel this request?',
      message: nameOf(id),
      confirmLabel: episode ? 'Cancel episode' : 'Cancel request',
      cancelLabel: 'Keep',
      destructive: true,
    })
    if (!ok) return
    setBusyId(id)
    try {
      await cancelRequest(serverUrl, token, id, episode)
      if (!episode) useRequesterLive.getState().patch(id, { status: 'cancelled' })
      toast.success(episode ? `${episode} cancelled` : 'Request cancelled')
      void useRequesterLive.getState().reload()
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not cancel'))
    }
    setBusyId(null)
  }, [serverUrl, token, confirm, toast])

  const retry = useCallback(async (id: number) => {
    if (!serverUrl || !token) return
    setBusyId(id)
    try {
      const req = await retryRequest(serverUrl, token, id)
      useRequesterLive.getState().patch(id, req)
      toast.success('Queued again')
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not retry'))
    }
    setBusyId(null)
  }, [serverUrl, token, toast])

  const showError = useCallback(async (id: number) => {
    if (!serverUrl || !token) return
    setBusyId(id)
    try {
      const d = await getRequestError(serverUrl, token, id)
      const perItem = [
        ...Object.entries(d.season_errors ?? {}).map(([k, v]) => `Season ${k}: ${v}`),
        ...Object.entries(d.episode_errors ?? {}).map(([k, v]) => `${k}: ${v}`),
      ]
      setBusyId(null)
      await confirm({
        title: 'Why it failed',
        message: [
          d.message || 'No message',
          d.stage ? `Stage: ${d.stage}` : null,
          d.retry_count ? `Retries: ${d.retry_count}` : null,
          ...perItem.slice(0, 15),
          perItem.length > 15 ? `… and ${perItem.length - 15} more` : null,
        ].filter(Boolean).join('\n'),
        confirmLabel: 'Close',
      })
    } catch (e) {
      toast.error(requesterErrorMessage(e, 'Could not load the error details'))
    }
    setBusyId(null)
  }, [serverUrl, token, confirm, toast])

  const remove = useCallback(async (id: number) => {
    if (!serverUrl || !token) return false
    const ok = await confirm({ title: 'Remove from history?', message: nameOf(id), confirmLabel: 'Remove', destructive: true })
    if (!ok) return false
    setBusyId(id)
    try {
      await deleteHistoryEntry(serverUrl, token, id)
      useRequesterLive.getState().remove(id)
      setBusyId(null)
      return true
    } catch (e) {
      // Only drop it when the server did (400 = still active, 403 = not yours)
      toast.error(requesterErrorMessage(e, 'Could not remove the entry'))
      setBusyId(null)
      return false
    }
  }, [serverUrl, token, confirm, toast])

  const clearAll = useCallback(async (isAdmin: boolean) => {
    if (!serverUrl || !token) return
    const ok = await confirm({
      title: 'Clear finished requests?',
      message: isAdmin
        ? 'Removes every finished, failed, cancelled and rejected request — for ALL users.'
        : 'Removes your finished, failed, cancelled and rejected requests.',
      confirmLabel: 'Clear',
      destructive: true,
    })
    if (!ok) return
    const done = await clearHistory(serverUrl, token)
    if (!done) toast.error('Could not clear the history')
    await useRequesterLive.getState().reload()
  }, [serverUrl, token, confirm, toast])

  return { cancel, retry, showError, remove, clearAll, busyId, confirmUi }
}
