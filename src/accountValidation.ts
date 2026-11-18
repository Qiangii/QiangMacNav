export const USERNAME_HINT = '账号长度应为 3–16 位，支持汉字、英文字母和数字。';
export const PASSWORD_LENGTH_HINT = '密码长度应为 6–16 位。';
export const PASSWORD_HINT = '密码长度应为 6–16 位，且至少包含字母、数字、符号中的两类。';
export const USERNAME_PLACEHOLDER = '账号（3–16 位）';
export const PASSWORD_PLACEHOLDER = '密码（6–16 位）';

export function validUsername(value: string) {
  return /^[\p{Script=Han}A-Za-z0-9]{3,16}$/u.test(value);
}

export function validPasswordLength(value: string) {
  const size = [...value].length;
  return size >= 6 && size <= 16 && !/\p{Cs}/u.test(value);
}

export function validPassword(value: string) {
  if (!validPasswordLength(value)) return false;
  const letters = /\p{L}/u.test(value);
  const digits = /\p{Nd}/u.test(value);
  const symbols = /[^\p{L}\p{Nd}]/u.test(value);
  return Number(letters) + Number(digits) + Number(symbols) >= 2;
}
