import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import type { Page } from "playwright";
import { trackActivePage } from "../src/browser/session.js";

interface FakePage {
  close: () => void;
  isClosed: () => boolean;
  name: string;
  once: (event: string, listener: () => void) => void;
}

function fakePage(name: string): FakePage {
  const emitter = new EventEmitter();
  let closed = false;
  return {
    close: () => {
      closed = true;
      emitter.emit("close");
    },
    isClosed: () => closed,
    name,
    once: (event, listener) => {
      emitter.once(event, listener);
    },
  };
}

function fakeContext(initialPages: FakePage[]) {
  const emitter = new EventEmitter();
  const pages = [...initialPages];
  return {
    on: (event: "page", listener: (page: Page) => void) => emitter.on(event, listener),
    open: (page: FakePage) => {
      pages.push(page);
      emitter.emit("page", page);
    },
    pages: () => pages.filter((page) => !page.isClosed()) as unknown as Page[],
  };
}

describe("trackActivePage", () => {
  test("adopts a newly opened tab as the active page", () => {
    const first = fakePage("first");
    const context = fakeContext([first]);
    const activePage = trackActivePage(context, first as unknown as Page);

    expect((activePage() as unknown as FakePage).name).toBe("first");

    const popup = fakePage("popup");
    context.open(popup);
    expect((activePage() as unknown as FakePage).name).toBe("popup");
  });

  test("falls back to the last open page when the active tab closes", () => {
    const first = fakePage("first");
    const context = fakeContext([first]);
    const activePage = trackActivePage(context, first as unknown as Page);

    const second = fakePage("second");
    const third = fakePage("third");
    context.open(second);
    context.open(third);

    third.close();
    expect((activePage() as unknown as FakePage).name).toBe("second");

    second.close();
    expect((activePage() as unknown as FakePage).name).toBe("first");
  });
});
