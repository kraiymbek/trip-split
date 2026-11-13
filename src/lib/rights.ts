// Менять и удалять запись (расход, отметку о возврате) может только тот, кто её внёс.
// То же правило проверяет сервер (миграция 0002); здесь — чтобы не показывать недоступные кнопки.

export function canModify(item: { created_by?: string; pending?: boolean }, me: string): boolean {
  if (item.pending) return true // ещё лежит в моей офлайн-очереди
  return !!me && item.created_by === me
}
