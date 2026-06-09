export function requiredSourceBlocker(
  label,
  device,
  { disabled = false, override, disableHint, allowForcedOverride = false } = {}
) {
  if (disabled) return null
  if (override && (allowForcedOverride || device?.status === 'available')) return null
  if (!device) return `${label} missing (set ${disableHint} to omit it intentionally)`
  if (device.status !== 'available') {
    return `${label} ${device.name} [${device.id}] is ${device.status} (set ${disableHint} to omit it intentionally)`
  }
  return null
}
