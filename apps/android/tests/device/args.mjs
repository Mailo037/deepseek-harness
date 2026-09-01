/** Shared CLI arg helper for the device test scripts. */

export function argOf(name, fallback) {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
