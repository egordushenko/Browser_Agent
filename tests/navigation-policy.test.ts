import { describe, expect, test } from "vitest";
import { extractAllowedNavigationUrls } from "../src/agent/navigation-policy.js";

describe("extractAllowedNavigationUrls", () => {
  test("allows only domains and full URLs explicitly present in the task", () => {
    expect(
      extractAllowedNavigationUrls(
        "Открой hh.ru и найди резюме. Если нужно, используй https://mail.yandex.ru/lite/",
      ),
    ).toEqual(["https://mail.yandex.ru/lite/", "https://hh.ru/"]);
  });

  test("does not invent internal paths for a mentioned domain", () => {
    expect(extractAllowedNavigationUrls("Открой hh.ru/resumes не было сказано, только hh.ru")).toEqual([
      "https://hh.ru/resumes",
      "https://hh.ru/",
    ]);
  });
});
