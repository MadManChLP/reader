import React from 'react'
import { BottomSheet } from '../BottomSheet'

/**
 * Reader panels: a floating dropdown on desktop, a drag-dismissible bottom
 * sheet on phones (thumb-reachable, back gesture closes it). The desktop
 * markup is unchanged — `className` is the old panel container's classes.
 */
export function PanelOrSheet({
  isPhone,
  title,
  onClose,
  className,
  children,
}: {
  isPhone: boolean
  title?: React.ReactNode
  onClose: () => void
  className: string
  children: React.ReactNode
}) {
  if (isPhone) {
    return (
      <BottomSheet title={title} onClose={onClose}>
        <div className="px-3 pb-3 space-y-5 text-white">{children}</div>
      </BottomSheet>
    )
  }
  return <div className={className}>{children}</div>
}
