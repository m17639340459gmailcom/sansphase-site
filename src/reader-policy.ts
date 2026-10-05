export const readerNicknameMax = 8;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const readerNicknameLength = (value: string) => Array.from(graphemes.segment(value)).length;
export function validReaderNickname(value: string): boolean {
  const length = readerNicknameLength(value);
  return length >= 2 && length <= readerNicknameMax && value.length <= 128 &&
    !/[\u0000-\u001f\u007f<>\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069]/u.test(value);
}
