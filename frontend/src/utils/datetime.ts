/** 把毫秒时间戳格式化为「YYYY-MM-DD HH:mm」，供移交时间与留痕回显使用 */
export function formatDateTime(input: number | null | undefined): string {
  if (typeof input !== 'number' || !Number.isFinite(input)) return '—'
  const date = new Date(input)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
