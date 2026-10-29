/**
 * Map a base-language resource to an isomorphic resource type whose values are all strings.
 * @template T Structure of the base-language resource.
 */
export type TranslationShape<T> = T extends string
  ? string
  : { [Key in keyof T]: TranslationShape<T[Key]> };
