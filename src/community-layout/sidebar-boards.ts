/** The menu has five ordinary slots and the existing members board last. */
export function sidebarCommunityBoards<T extends { id: string }>(items: readonly T[]): T[] {
  return [
    ...items.filter(item => item.id !== 'vip').slice(0, 5),
    ...items.filter(item => item.id === 'vip').slice(0, 1),
  ];
}
