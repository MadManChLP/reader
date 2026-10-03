import { IS_PHONE } from '../utils/api'

// Uniform hook for phone-layout decisions. Static today (device-class detection),
// but keeps call sites future-proof if detection ever becomes dynamic.
export const useIsPhone = () => IS_PHONE
