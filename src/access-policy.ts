export const publicRoute = (page: string): boolean =>
  ['home', 'notes', 'note'].includes(page);

export const publicKind = (kind: string): boolean => kind === 'notes';
