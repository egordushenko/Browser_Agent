/** Accept common short affirmative answers in English and Russian. */
export function isAffirmativeAnswer(answer: string): boolean {
  return /^(y|yes|confirm|да|д|подтверждаю)$/iu.test(answer.trim());
}
