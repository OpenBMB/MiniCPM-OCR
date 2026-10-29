/**
 * 将基准语言资源映射为值均为字符串的同构资源类型。
 * @template T 基准语言资源的结构。
 */
export type TranslationShape<T> = T extends string
  ? string
  : { [Key in keyof T]: TranslationShape<T[Key]> };
