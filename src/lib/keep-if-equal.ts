/**
 * Para sondeos periódicos: si la respuesta es idéntica al estado actual devuelve el MISMO objeto,
 * así React no vuelve a pintar la lista cada 5 s cuando no cambió nada. Solo para datos simples
 * (JSON/fechas), como las listas que devuelven las acciones del servidor.
 */
export function keepIfEqual<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
